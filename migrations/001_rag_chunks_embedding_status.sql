-- ============================================================
--  Migration: rag_chunks — atomic embedding state machine
-- ============================================================
--
--  Run this once in Supabase SQL Editor (Dashboard → SQL Editor)
--  before using the updated embed-chunks.ts agent.
--
--  New columns:
--    content_hash        TEXT UNIQUE  — MD5 of chunk content (dedup key)
--    embedding_status    TEXT         — pending | processing | done | failed
--    embedding_claimed_at TIMESTAMPTZ — when the agent claimed the row
-- ============================================================

-- 1. content_hash — used by rag-ingest.ts to skip duplicates on insert
ALTER TABLE public.rag_chunks
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Backfill hash for any existing rows (requires pgcrypto)
UPDATE public.rag_chunks
  SET content_hash = md5(content)
  WHERE content_hash IS NULL;

-- Unique index so duplicate inserts get a 23505 conflict instead of silently
-- succeeding (the TS code already handles this code gracefully).
CREATE UNIQUE INDEX IF NOT EXISTS rag_chunks_content_hash_key
  ON public.rag_chunks (content_hash);

-- 2. embedding_status — drives the state machine in embed-chunks.ts
ALTER TABLE public.rag_chunks
  ADD COLUMN IF NOT EXISTS embedding_status TEXT
    DEFAULT 'pending'
    CHECK (embedding_status IN ('pending', 'processing', 'done', 'failed'));

-- Seed existing rows:
--   • rows with a vector already → 'done'
--   • rows without a vector      → 'pending'
UPDATE public.rag_chunks
  SET embedding_status = CASE
    WHEN embedding IS NOT NULL THEN 'done'
    ELSE 'pending'
  END
  WHERE embedding_status IS NULL OR embedding_status = 'pending';

-- 3. embedding_claimed_at — lets the agent detect stale 'processing' rows
ALTER TABLE public.rag_chunks
  ADD COLUMN IF NOT EXISTS embedding_claimed_at TIMESTAMPTZ;

-- 4. Indexes for the agent's query pattern
--    (filter rows quickly without a full-table scan)
CREATE INDEX IF NOT EXISTS rag_chunks_embed_status_idx
  ON public.rag_chunks (embedding_status)
  WHERE embedding_status IN ('pending', 'processing', 'failed');

-- ============================================================
--  Verify
-- ============================================================
SELECT
  embedding_status,
  COUNT(*) AS total
FROM public.rag_chunks
GROUP BY embedding_status
ORDER BY embedding_status;
