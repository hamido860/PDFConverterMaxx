import { GoogleGenAI } from "@google/genai";

// Initialize the Gemini AI client
// The GEMINI_API_KEY is automatically provided in the environment
const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY || '' 
});

/**
 * Generates a response using the Gemini 3 Flash model.
 * In this environment, we use the native Gemini API instead of localhost endpoints.
 */
export async function generateAiResponse(prompt: string, systemInstruction?: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction || "You are an expert curriculum designer for Moroccan education.",
        temperature: 0.7,
      },
    });

    return response.text;
  } catch (error) {
    console.error("AI Generation Error:", error);
    throw error;
  }
}
