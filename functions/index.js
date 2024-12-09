const functions = require("firebase-functions");
const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.translate = functions.https.onCall(async (data, context) => {
  try {
    const API_KEY = process.env.GEMINI_API_KEY;
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const prompt = `Translate the following Japanese text to English: "${data.text}"`;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const translatedText = response.text();

    return { translatedText };
  } catch (error) {
    console.error("Translation error:", error);
    throw new functions.https.HttpsError("internal", "Translation failed");
  }
});
