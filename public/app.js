mdc.ripple.MDCRipple.attachTo(document.querySelector(".mdc-button"));

// DEfault configuration - Change these if you have a different STUN or TURN server.
const configuration = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
  iceCandidatePoolSize: 10,
};

let peerConnection = null;
let localStream = null;
let remoteStream = null;
let roomDialog = null;
let roomId = null;

function init() {
  document.querySelector("#cameraBtn").addEventListener("click", openUserMedia);
  document.querySelector("#hangupBtn").addEventListener("click", hangUp);
  document.querySelector("#createBtn").addEventListener("click", createRoom);
  document.querySelector("#joinBtn").addEventListener("click", joinRoom);
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector("#room-dialog"));
}

async function createRoom() {
  document.querySelector("#createBtn").disabled = true;
  document.querySelector("#joinBtn").disabled = true;
  const db = firebase.firestore();

  console.log("Create PeerConnection with configuration: ", configuration);
  peerConnection = new RTCPeerConnection(configuration);

  registerPeerConnectionListeners();

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  // Add code for creating a room here
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  const roomWithOffer = {
    offer: {
      type: offer.type,
      sdp: offer.sdp,
    },
  };
  const roomRef = await db.collection("rooms").add(roomWithOffer);
  const roomId = roomRef.id;
  document.querySelector(
    "#currentRoom"
  ).innerText = `Current room is ${roomId} - You are the caller!`;

  // Code for creating room above

  // Code for collecting ICE candidates below
  const callerCandidatesCollection = roomRef.collection("callerCandidates");

  peerConnection.addEventListener("icecandidate", (event) => {
    if (!event.candidate) {
      console.log("Got final candidate!");
      return;
    }
    console.log("Got candidate: ", event.candidate);
    callerCandidatesCollection.add(event.candidate.toJSON());
  });
  // Code for collecting ICE candidates above

  peerConnection.addEventListener("track", (event) => {
    console.log("Got remote track:", event.streams[0]);
    event.streams[0].getTracks().forEach((track) => {
      console.log("Add a track to the remoteStream:", track);
      remoteStream.addTrack(track);
    });

    // リモート音声の認識を開始
    startRemoteTranslation(event.streams[0]);
  });

  // Listening for remote session description below
  roomRef.onSnapshot(async (snapshot) => {
    console.log("Got updated room:", snapshot.data());
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data.answer) {
      console.log("Set remote description: ", data.answer);
      const answer = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(answer);
    }
  });
  // Listening for remote session description above

  // Listen for remote ICE candidates below
  roomRef.collection("calleeCandidates").onSnapshot((snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === "added") {
        let data = change.doc.data();
        console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
        await peerConnection.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
  // Listen for remote ICE candidates above
}

function joinRoom() {
  document.querySelector("#createBtn").disabled = true;
  document.querySelector("#joinBtn").disabled = true;

  document.querySelector("#confirmJoinBtn").addEventListener(
    "click",
    async () => {
      roomId = document.querySelector("#room-id").value;
      console.log("Join room: ", roomId);
      document.querySelector(
        "#currentRoom"
      ).innerText = `Current room is ${roomId} - You are the callee!`;
      await joinRoomById(roomId);
    },
    { once: true }
  );
  roomDialog.open();
}

async function joinRoomById(roomId) {
  const db = firebase.firestore();
  const roomRef = db.collection("rooms").doc(`${roomId}`);
  const roomSnapshot = await roomRef.get();
  console.log("Got room:", roomSnapshot.exists);

  if (roomSnapshot.exists) {
    console.log("Create PeerConnection with configuration: ", configuration);
    peerConnection = new RTCPeerConnection(configuration);
    registerPeerConnectionListeners();
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    // Code for collecting ICE candidates below
    const calleeCandidatesCollection = roomRef.collection("calleeCandidates");
    peerConnection.addEventListener("icecandidate", (event) => {
      if (!event.candidate) {
        console.log("Got final candidate!");
        return;
      }
      console.log("Got candidate: ", event.candidate);
      calleeCandidatesCollection.add(event.candidate.toJSON());
    });
    // Code for collecting ICE candidates above

    peerConnection.addEventListener("track", (event) => {
      console.log("Got remote track:", event.streams[0]);
      event.streams[0].getTracks().forEach((track) => {
        console.log("Add a track to the remoteStream:", track);
        remoteStream.addTrack(track);
      });
    });

    // Code for creating SDP answer below
    const offer = roomSnapshot.data().offer;
    console.log("Got offer:", offer);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    console.log("Created answer:", answer);
    await peerConnection.setLocalDescription(answer);

    const roomWithAnswer = {
      answer: {
        type: answer.type,
        sdp: answer.sdp,
      },
    };
    await roomRef.update(roomWithAnswer);
    // Code for creating SDP answer above

    // Listening for remote ICE candidates below
    roomRef.collection("callerCandidates").onSnapshot((snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === "added") {
          let data = change.doc.data();
          console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
          await peerConnection.addIceCandidate(new RTCIceCandidate(data));
        }
      });
    });
    // Listening for remote ICE candidates above
  }
}

async function openUserMedia(e) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  document.querySelector("#localVideo").srcObject = stream;
  localStream = stream;
  remoteStream = new MediaStream();
  document.querySelector("#remoteVideo").srcObject = remoteStream;

  console.log("Stream:", document.querySelector("#localVideo").srcObject);
  document.querySelector("#cameraBtn").disabled = true;
  document.querySelector("#joinBtn").disabled = false;
  document.querySelector("#createBtn").disabled = false;
  document.querySelector("#hangupBtn").disabled = false;

  // await startTranslation();
}

async function hangUp(e) {
  const tracks = document.querySelector("#localVideo").srcObject.getTracks();
  tracks.forEach((track) => {
    track.stop();
  });

  if (remoteStream) {
    remoteStream.getTracks().forEach((track) => track.stop());
  }

  if (peerConnection) {
    peerConnection.close();
  }

  document.querySelector("#localVideo").srcObject = null;
  document.querySelector("#remoteVideo").srcObject = null;
  document.querySelector("#cameraBtn").disabled = false;
  document.querySelector("#joinBtn").disabled = true;
  document.querySelector("#createBtn").disabled = true;
  document.querySelector("#hangupBtn").disabled = true;
  document.querySelector("#currentRoom").innerText = "";

  // Delete room on hangup
  if (roomId) {
    const db = firebase.firestore();
    const roomRef = db.collection("rooms").doc(roomId);
    const calleeCandidates = await roomRef.collection("calleeCandidates").get();
    calleeCandidates.forEach(async (candidate) => {
      await candidate.delete();
    });
    const callerCandidates = await roomRef.collection("callerCandidates").get();
    callerCandidates.forEach(async (candidate) => {
      await candidate.delete();
    });
    await roomRef.delete();
  }

  document.location.reload(true);
}

function registerPeerConnectionListeners() {
  peerConnection.addEventListener("icegatheringstatechange", () => {
    console.log(
      `ICE gathering state changed: ${peerConnection.iceGatheringState}`
    );
  });

  peerConnection.addEventListener("connectionstatechange", () => {
    console.log(`Connection state change: ${peerConnection.connectionState}`);
  });

  peerConnection.addEventListener("signalingstatechange", () => {
    console.log(`Signaling state change: ${peerConnection.signalingState}`);
  });

  peerConnection.addEventListener("iceconnectionstatechange ", () => {
    console.log(
      `ICE connection state change: ${peerConnection.iceConnectionState}`
    );
  });
}

async function startTranslation() {
  try {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();

    recognition.lang = "ja-JP"; // 日本語に設定
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = async (event) => {
      const result = event.results[event.results.length - 1];
      if (result.isFinal) {
        const text = result.item(0).transcript;
        console.log("Recognized text:", text);
        const translatedText = await translateText(text);
        displaySubtitle(translatedText);
        await speakTextToStream(translatedText, destination.stream);

        // // 既存の音声トラックを削除
        // const audioTracks = localStream.getAudioTracks();
        // audioTracks.forEach((track) => {
        //   localStream.removeTrack(track);
        //   track.stop();
        // });

        // 翻訳された音声トラックを追加
        destination.stream.getAudioTracks().forEach((track) => {
          localStream.addTrack(track);
        });
      }
    };

    recognition.onerror = (event) => {
      alert("Recognition error:", event.error);
    };

    recognition.start();
  } catch (error) {
    alert("Translation setup failed:", error);
  }
}

async function speakTextToStream(text, stream) {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onend = () => {
      resolve();
    };

    window.speechSynthesis.speak(utterance);
  });
}

async function translateText(text) {
  // 空のテキストの場合は翻訳しない
  if (!text || text.trim() === "") {
    return "";
  }

  try {
    const translateFunction = firebase.functions().httpsCallable("translate");
    const result = await translateFunction({ text });
    const translatedText = result.data.translatedText;

    console.log("Original:", text);
    console.log("Translated:", translatedText);

    return translatedText;
  } catch (error) {
    console.error("Translation error:", error);
    return text;
  }
}

function displaySubtitle(text) {
  const subtitleElement = document.querySelector("#subtitle");
  if (!subtitleElement) {
    console.error("Subtitle element not found");
    return;
  }
  console.log("Displaying subtitle:", text);
  subtitleElement.innerText = text;
}

async function startRemoteTranslation(remoteStream) {
  try {
    console.log("startRemoteTranslation");
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(remoteStream);
    const destination = audioContext.createMediaStreamDestination();
    source.connect(destination);

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.lang = "ja-JP";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = async (event) => {
      console.log("remote recognition onresult");
      const result = event.results[event.results.length - 1];
      if (result.isFinal) {
        const text = result.item(0).transcript;
        console.log("Remote speech recognized:", text);
        // 必要に応じて日本語に翻訳したり、字幕表示したりできます
        displayRemoteSubtitle(text);

        const translatedText = await translateText(text);
        displaySubtitle(translatedText);
        await speakTextToStream(translatedText, destination.stream);
      }
    };

    recognition.onerror = (event) => {
      console.error("Remote recognition error:", event.error);
    };

    recognition.start();
  } catch (error) {
    console.error("Remote translation setup failed:", error);
  }
}

function displayRemoteSubtitle(text) {
  const remoteSubtitleElement = document.querySelector("#remoteSubtitle");
  if (!remoteSubtitleElement) {
    console.error("Remote subtitle element not found");
    return;
  }
  console.log("Displaying remote subtitle:", text);
  remoteSubtitleElement.innerText = text;
}

init();
