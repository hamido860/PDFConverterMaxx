-- ============================================================
--  Migration 002: resize embedding columns from 768 → 1000 dims
-- ============================================================
--  Run in Supabase SQL Editor BEFORE re-embedding with
--  gemini-embedding-exp-03-07 at outputDimensionality=1000.
--
--  ⚠️  This DELETES all existing embedding vectors so they
--  can be re-generated at the new dimension.  Make sure
--  embed-chunks.ts is ready to back-fill them afterward.
-- ============================================================

-- 1. rag_chunks
ALTER TABLE public.rag_chunks
  DROP COLUMN IF EXISTS embedding;

ALTER TABLE public.rag_chunks
  ADD COLUMN embedding vector(1000);

-- Reset status so embed-chunks.ts will re-embed every row
UPDATE public.rag_chunks
  SET embedding_status = 'pending',
      embedding_claimed_at = NULL;

-- 2. lessons  (if your app also does semantic search on lessons)
ALTER TABLE public.lessons
  DROP COLUMN IF EXISTS embedding;

ALTER TABLE public.lessons
  ADD COLUMN embedding vector(1000);

-- 3. embeddings table  (user-level embeddings)
ALTER TABLE public.embeddings
  DROP COLUMN IF EXISTS embedding;

ALTER TABLE public.embeddings
  ADD COLUMN embedding vector(1000);

-- 4. Re-create the ivfflat / hnsw index at the new dimension
--    (drop old index first if it exists)
DROP INDEX IF EXISTS rag_chunks_embedding_idx;

CREATE INDEX rag_chunks_embedding_idx
  ON public.rag_chunks
  USING hnsw (embedding vector_cosine_ops);

-- ============================================================
--  Verify
-- ============================================================
SELECT
  column_name,
  udt_name,
  character_maximum_length
FROM information_schema.columns
WHERE table_name IN ('rag_chunks', 'lessons', 'embeddings')
  AND column_name = 'embedding';
