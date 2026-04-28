import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function listModels() {
    try {
        const response = await genai.models.list();
        const models = response;
        console.log('Available models:');
        for await (const model of models) {
            if (model.name.includes('embed')) {
                console.log(`- ${model.name} (${model.description})`);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

listModels();
