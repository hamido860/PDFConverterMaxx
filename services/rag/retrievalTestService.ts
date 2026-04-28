import { embeddingService } from './embeddingService';
import { supabaseRagService } from './supabaseRagService';
import { cosineSimilarity } from './utils';

export const retrievalTestService = {
  async testChunkRetrieval(input: { chunkId: string; queryText?: string; documentId?: string | null }) {
    const chunkRecord = await supabaseRagService.getChunk(input.chunkId);
    const chunk = chunkRecord.chunk;
    const queryText = input.queryText?.trim() || `${chunk.title ?? 'Chunk'} ${String(chunk.content).slice(0, 240)}`;
    const queryEmbedding = await embeddingService.embedText(queryText);
    const embeddings = await supabaseRagService.getActiveEmbeddings(input.documentId ?? chunk.document_id ?? undefined);

    const ranked = embeddings
      .map(entry => ({
        chunkId: entry.chunkId,
        score: cosineSimilarity(queryEmbedding, entry.embedding),
        title: entry.title,
        content: entry.content,
        documentId: entry.documentId,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const result = await supabaseRagService.saveRetrievalTest({
      chunkId: chunk.id,
      queryText,
      retrievedChunkIds: ranked.map(item => item.chunkId),
      retrievedScores: ranked.map(item => Number(item.score.toFixed(4))),
      passed: ranked.some(item => item.chunkId === chunk.id),
      metadata: {
        document_id: input.documentId ?? chunk.document_id ?? null,
      },
    });

    return { queryText, ranked, saved: result };
  },
};
