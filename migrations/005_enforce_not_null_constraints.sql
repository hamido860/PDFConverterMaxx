-- ============================================================
--  Migration: Enforce NOT NULL constraints on key columns
-- ============================================================
--
--  After audit, all chunks have valid values for these columns.
--  Enforcing NOT NULL ensures data integrity going forward.
--
-- ============================================================

-- 1. updated_at — backfill any NULL with created_at
UPDATE public.rag_chunks
SET updated_at = created_at
WHERE updated_at IS NULL;

-- Make updated_at NOT NULL
ALTER TABLE public.rag_chunks
ALTER COLUMN updated_at SET NOT NULL;

-- 2. embedding_status — already has default 'pending'
ALTER TABLE public.rag_chunks
ALTER COLUMN embedding_status SET NOT NULL;

-- 3. content_hash — generate MD5 for any NULL
UPDATE public.rag_chunks
SET content_hash = md5(content)
WHERE content_hash IS NULL;

-- Make content_hash NOT NULL
ALTER TABLE public.rag_chunks
ALTER COLUMN content_hash SET NOT NULL;

-- 4. chunk_size — all values already exist (audit confirmed)
-- Make chunk_size NOT NULL
ALTER TABLE public.rag_chunks
ALTER COLUMN chunk_size SET NOT NULL;

-- 5. chunk_index — backfill any NULL with 0
UPDATE public.rag_chunks
SET chunk_index = 0
WHERE chunk_index IS NULL;

-- Make chunk_index NOT NULL
ALTER TABLE public.rag_chunks
ALTER COLUMN chunk_index SET NOT NULL;

-- ============================================================
--  Verify all constraints are in place
-- ============================================================
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'rag_chunks'
  AND column_name IN ('created_at', 'updated_at', 'chunk_size', 'chunk_index', 'content_hash', 'embedding_status')
ORDER BY ordinal_position;
