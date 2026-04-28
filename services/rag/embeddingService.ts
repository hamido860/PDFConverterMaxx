import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const EMBEDDING_MODEL = process.env.RAG_EMBEDDING_MODEL || 'gemini-embedding-exp-03-07';
const EMBEDDING_DIMENSIONS = 768;

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

export const embeddingService = {
  dimensions: EMBEDDING_DIMENSIONS,

  async embedText(content: string): Promise<number[]> {
    if (!ai) {
      throw new Error('GEMINI_API_KEY is not configured for embeddings');
    }

    const result = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: [{ parts: [{ text: content }] }],
      config: {
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: EMBEDDING_DIMENSIONS,
      } as any,
    });

    const values = result.embeddings?.[0]?.values;
    if (!values || values.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Embedding provider returned ${values?.length ?? 0} dimensions; expected ${EMBEDDING_DIMENSIONS}`);
    }

    return Array.from(values);
  },
};
