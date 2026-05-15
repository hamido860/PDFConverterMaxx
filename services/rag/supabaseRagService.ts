import { createClient } from '@supabase/supabase-js';
import type { ChunkFilters, RagChunkStatus, RagJobStatus } from './types';
import { createContentHash, normalizeChunkContent, parseVector } from './utils';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || ''
);

async function appendLog(jobId: string, message: string, level: 'info' | 'warn' | 'error' = 'info') {
  const { data: job } = await supabase
    .from('rag_extraction_jobs')
    .select('logs')
    .eq('id', jobId)
    .maybeSingle();

  const nextLogs = Array.isArray(job?.logs) ? [...job.logs] : [];
  nextLogs.push({
    message,
    level,
    at: new Date().toISOString(),
  });

  await supabase
    .from('rag_extraction_jobs')
    .update({ logs: nextLogs, updated_at: new Date().toISOString() })
    .eq('id', jobId);
}

async function resolveMetadataReferences(payload: {
  gradeId?: string | null;
  subjectId?: string | null;
  topicId?: string | null;
  topicTitle?: string | null;
  gradeName?: string | null;
  subjectName?: string | null;
}) {
  let gradeId = payload.gradeId ?? null;
  let subjectId = payload.subjectId ?? null;
  let topicId = payload.topicId ?? null;

  if (!gradeId && payload.gradeName) {
    const { data } = await supabase.from('grades').select('id').ilike('name', payload.gradeName).maybeSingle();
    gradeId = data?.id ?? null;
  }

  if (!subjectId && payload.subjectName) {
    const { data } = await supabase.from('subjects').select('id').ilike('name', payload.subjectName).maybeSingle();
    subjectId = data?.id ?? null;
  }

  if (!topicId && payload.topicTitle && gradeId && subjectId) {
    const { data } = await supabase
      .from('topics')
      .select('id')
      .eq('grade_id', gradeId)
      .eq('subject_id', subjectId)
      .ilike('title', payload.topicTitle)
      .maybeSingle();
    topicId = data?.id ?? null;
  }

  return { gradeId, subjectId, topicId };
}

export const supabaseRagService = {
  client: supabase,

  async listGradeNames(): Promise<string[]> {
    const { data } = await supabase.from('grades').select('name').order('name');
    return (data ?? []).map(row => row.name).filter(Boolean);
  },

  async listSubjectNames(): Promise<string[]> {
    const { data } = await supabase.from('subjects').select('name').order('name');
    return (data ?? []).map(row => row.name).filter(Boolean);
  },

  async createDocumentAndJob(input: {
    originalFilename: string;
    filePath: string;
    fileSize: number;
    mimeType: string;
  }) {
    const now = new Date().toISOString();
    const { data: document, error: documentError } = await supabase
      .from('rag_documents')
      .insert({
        original_filename: input.originalFilename,
        filename: input.originalFilename,
        file_path: input.filePath,
        file_size: input.fileSize,
        mime_type: input.mimeType,
        metadata: {},
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();

    if (documentError) throw documentError;

    const { data: job, error: jobError } = await supabase
      .from('rag_extraction_jobs')
      .insert({
        document_id: document.id,
        status: 'pending',
        logs: [],
        retry_count: 0,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();

    if (jobError) throw jobError;

    return { document, job };
  },

  async updateJob(jobId: string, patch: Partial<{ status: RagJobStatus; error_message: string | null; retry_count: number; started_at: string | null; completed_at: string | null; metadata: any }>) {
    const payload: Record<string, any> = {
      ...patch,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('rag_extraction_jobs').update(payload).eq('id', jobId);
    if (error) throw error;
  },

  async appendJobLog(jobId: string, message: string, level: 'info' | 'warn' | 'error' = 'info') {
    await appendLog(jobId, message, level);
  },

  async updateDocument(documentId: string, patch: Record<string, any>) {
    const { error } = await supabase
      .from('rag_documents')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', documentId);
    if (error) throw error;
  },

  async getExistingHashes(documentId: string): Promise<Set<string>> {
    const { data, error } = await supabase
      .from('rag_chunks')
      .select('content_hash')
      .eq('document_id', documentId);
    if (error) throw error;
    return new Set((data ?? []).map(row => row.content_hash).filter(Boolean));
  },

  async insertChunk(input: Record<string, any>) {
    const normalizedContent = normalizeChunkContent(input.content || '');
    const contentHash = createContentHash(normalizedContent);
    const now = new Date().toISOString();
    const resolvedRefs = await resolveMetadataReferences({
      gradeId: input.grade_id,
      subjectId: input.subject_id,
      topicId: input.topic_id,
      gradeName: input.grade_name,
      subjectName: input.subject_name,
      topicTitle: input.topic_title,
    });
    const payload: Record<string, any> = {
      ...input,
      content: normalizedContent,
      content_hash: contentHash,
      grade_id: resolvedRefs.gradeId,
      subject_id: resolvedRefs.subjectId,
      topic_id: resolvedRefs.topicId,
      metadata: input.metadata ?? {},
      created_at: now,
      updated_at: now,
    };
    delete payload.grade_name;
    delete payload.subject_name;
    delete payload.topic_title;

    const { data, error } = await supabase
      .from('rag_chunks')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw error;
    return data;
  },

  async getChunk(chunkId: string) {
    const { data: chunk, error } = await supabase
      .from('rag_chunks')
      .select('*')
      .eq('id', chunkId)
      .single();
    if (error) throw error;

    const [{ data: versions }, { data: embeddings }] = await Promise.all([
      supabase.from('rag_chunk_versions').select('*').eq('chunk_id', chunkId).order('version_index', { ascending: false }),
      supabase.from('rag_embeddings').select('*').eq('chunk_id', chunkId).order('created_at', { ascending: false }),
    ]);

    return { chunk, versions: versions ?? [], embeddings: embeddings ?? [] };
  },

  async listChunks(filters: ChunkFilters) {
    let query = supabase
      .from('rag_chunks')
      .select(`
        *,
        rag_documents(id, filename, original_filename),
        grades(name),
        subjects(name),
        topics(title)
      `)
      .order('updated_at', { ascending: false })
      .limit(500);

    if (filters.documentId) query = query.eq('document_id', filters.documentId);
    if (filters.gradeId) query = query.eq('grade_id', filters.gradeId);
    if (filters.subjectId) query = query.eq('subject_id', filters.subjectId);
    if (filters.status) query = query.eq('repair_status', filters.status);
    if (filters.minQualityScore !== undefined) query = query.gte('quality_score', filters.minQualityScore);
    if (filters.ocrDetected !== undefined) query = query.eq('ocr_detected', filters.ocrDetected);
    if (filters.duplicate !== undefined) query = query.eq('is_duplicate', filters.duplicate);

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  },

  async listJobs() {
    const { data, error } = await supabase
      .from('rag_extraction_jobs')
      .select(`
        *,
        rag_documents(id, filename, original_filename, file_path, file_size)
      `)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return data ?? [];
  },

  async listMetadataOptions() {
    const [{ data: documents }, { data: grades }, { data: subjects }, { data: topics }] = await Promise.all([
      supabase.from('rag_documents').select('id, filename').order('filename'),
      supabase.from('grades').select('id, name').order('name'),
      supabase.from('subjects').select('id, name').order('name'),
      supabase.from('topics').select('id, title').order('title').limit(2000),
    ]);

    return {
      documents: documents ?? [],
      grades: grades ?? [],
      subjects: subjects ?? [],
      topics: topics ?? [],
    };
  },

  async saveChunkVersion(chunkId: string, currentContent: string, currentMetadata: Record<string, any>, note: string) {
    const { data: existingVersions } = await supabase
      .from('rag_chunk_versions')
      .select('version_index')
      .eq('chunk_id', chunkId)
      .order('version_index', { ascending: false })
      .limit(1);

    const nextVersion = (existingVersions?.[0]?.version_index ?? 0) + 1;
    const { error } = await supabase.from('rag_chunk_versions').insert({
      chunk_id: chunkId,
      version_index: nextVersion,
      content: currentContent,
      content_hash: createContentHash(currentContent),
      metadata: {
        ...(currentMetadata ?? {}),
        note,
      },
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
  },

  async saveChunkEdits(input: {
    chunkId: string;
    content: string;
    title?: string | null;
    language?: string | null;
    pageStart?: number | null;
    pageEnd?: number | null;
    gradeId?: string | null;
    subjectId?: string | null;
    topicId?: string | null;
    topicTitle?: string | null;
    gradeName?: string | null;
    subjectName?: string | null;
    metadata?: Record<string, any>;
    repairStatus?: RagChunkStatus;
    reviewNotes?: string[];
  }) {
    const { chunk } = await this.getChunk(input.chunkId);
    const normalized = normalizeChunkContent(input.content);
    const nextHash = createContentHash(normalized);
    const contentChanged = chunk.content !== normalized;

    const resolvedRefs = await resolveMetadataReferences({
      gradeId: input.gradeId,
      subjectId: input.subjectId,
      topicId: input.topicId,
      topicTitle: input.topicTitle,
      gradeName: input.gradeName,
      subjectName: input.subjectName,
    });

    if (contentChanged) {
      await this.saveChunkVersion(chunk.id, chunk.content, chunk.metadata ?? {}, 'pre_edit_snapshot');
      await this.markEmbeddingsInactive(chunk.id);
    }

    const metadata = {
      ...(chunk.metadata ?? {}),
      ...(input.metadata ?? {}),
      review_notes: input.reviewNotes ?? chunk.metadata?.review_notes ?? [],
    };

    const { data, error } = await supabase
      .from('rag_chunks')
      .update({
        content: normalized,
        content_hash: nextHash,
        title: input.title ?? chunk.title,
        language: input.language ?? chunk.language,
        page_start: input.pageStart ?? chunk.page_start,
        page_end: input.pageEnd ?? chunk.page_end,
        grade_id: resolvedRefs.gradeId,
        subject_id: resolvedRefs.subjectId,
        topic_id: resolvedRefs.topicId,
        metadata,
        repair_status: input.repairStatus ?? chunk.repair_status,
        quality_score: chunk.quality_score,
        embedding_status: contentChanged ? 'pending' : chunk.embedding_status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', chunk.id)
      .select('*')
      .single();

    if (error) throw error;
    return data;
  },

  async rejectChunk(chunkId: string) {
    const { error } = await supabase
      .from('rag_chunks')
      .update({
        repair_status: 'rejected',
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', chunkId);
    if (error) throw error;
  },

  async markEmbeddingsInactive(chunkId: string) {
    await supabase
      .from('rag_embeddings')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('chunk_id', chunkId)
      .eq('is_active', true);
  },

  async saveEmbedding(chunkId: string, embedding: number[], model: string) {
    const now = new Date().toISOString();
    await this.markEmbeddingsInactive(chunkId);
    const { error: insertError } = await supabase
      .from('rag_embeddings')
      .insert({
        chunk_id: chunkId,
        embedding,
        model,
        is_active: true,
        metadata: {},
        created_at: now,
        updated_at: now,
      });
    if (insertError) throw insertError;

    const { error: chunkError } = await supabase
      .from('rag_chunks')
      .update({
        embedding,
        embedding_status: 'done',
        repair_status: 'embedded',
        updated_at: now,
      })
      .eq('id', chunkId);
    if (chunkError) throw chunkError;
  },

  async markEmbeddingFailed(chunkId: string, reason: string) {
    const { data: chunk } = await supabase.from('rag_chunks').select('metadata').eq('id', chunkId).maybeSingle();
    const metadata = {
      ...(chunk?.metadata ?? {}),
      embedding_error: reason,
    };

    const { error } = await supabase
      .from('rag_chunks')
      .update({
        repair_status: 'embedding_failed',
        embedding_status: 'failed',
        metadata,
        updated_at: new Date().toISOString(),
      })
      .eq('id', chunkId);
    if (error) throw error;
  },

  async getActiveEmbeddings(documentId?: string) {
    let query = supabase
      .from('rag_chunks')
      .select('id, title, content, document_id, embedding')
      .not('embedding', 'is', null)
      .eq('is_active', true);

    if (documentId) {
      query = query.eq('document_id', documentId);
    }

    const { data, error } = await query.limit(1000);
    if (error) throw error;

    return (data ?? []).map((row: any) => ({
      id: row.id,
      chunkId: row.id,
      embedding: parseVector(row.embedding),
      model: row.embedding_model || 'unknown',
      title: row.title ?? null,
      content: row.content ?? '',
      documentId: row.document_id ?? null,
    }));
  },

  async saveRetrievalTest(record: {
    chunkId?: string | null;
    queryText: string;
    retrievedChunkIds: string[];
    retrievedScores: number[];
    passed: boolean;
    metadata?: Record<string, any>;
  }) {
    const { data, error } = await supabase
      .from('rag_retrieval_tests')
      .insert({
        chunk_id: record.chunkId ?? null,
        query_text: record.queryText,
        retrieved_chunk_ids: record.retrievedChunkIds,
        retrieved_scores: record.retrievedScores,
        passed: record.passed,
        metadata: record.metadata ?? {},
        created_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  },
};
