-- ============================================================
--  Migration 003: Comprehensive null cleanup for rag_chunks
-- ============================================================
--  Run each section in order in the Supabase SQL Editor.
--  Each section starts with a SELECT so you can preview
--  what will be affected before the DELETE / UPDATE runs.
-- ============================================================


-- ──────────────────────────────────────────────────────────────
--  SECTION 0 — Diagnosis: see the breakdown of nulls
-- ──────────────────────────────────────────────────────────────
SELECT
  COUNT(*)                                              AS total_rows,
  COUNT(*) FILTER (WHERE content IS NULL)               AS null_content,
  COUNT(*) FILTER (WHERE content_hash IS NULL)          AS null_hash,
  COUNT(*) FILTER (WHERE embedding IS NULL)             AS null_embedding,
  COUNT(*) FILTER (WHERE source_id IS NULL)             AS null_source_id,
  COUNT(*) FILTER (WHERE embedding_status IS NULL)      AS null_status,
  COUNT(*) FILTER (WHERE embedding_status = 'failed')   AS failed_status,
  COUNT(*) FILTER (
    WHERE metadata->>'grade'   IS NULL
       OR metadata->>'grade'   = 'null'
  )                                                     AS null_grade,
  COUNT(*) FILTER (
    WHERE metadata->>'subject' IS NULL
       OR metadata->>'subject' = 'null'
  )                                                     AS null_subject
FROM public.rag_chunks;


-- ──────────────────────────────────────────────────────────────
--  SECTION 1 — DROP rows with null content (completely broken)
-- ──────────────────────────────────────────────────────────────
-- Preview:
SELECT id, created_at FROM public.rag_chunks WHERE content IS NULL;

-- Execute:
DELETE FROM public.rag_chunks WHERE content IS NULL;


-- ──────────────────────────────────────────────────────────────
--  SECTION 2 — DROP rows where content is too short (<50 chars)
-- ──────────────────────────────────────────────────────────────
-- Preview:
SELECT id, length(content) AS len, content
FROM public.rag_chunks
WHERE length(trim(content)) < 50;

-- Execute:
DELETE FROM public.rag_chunks WHERE length(trim(content)) < 50;


-- ──────────────────────────────────────────────────────────────
--  SECTION 3 — BACKFILL missing content_hash (fix, don't drop)
-- ──────────────────────────────────────────────────────────────
-- Requires pgcrypto (enabled by default in Supabase)
-- Preview:
SELECT COUNT(*) AS rows_needing_hash
FROM public.rag_chunks
WHERE content_hash IS NULL;

-- Execute:
UPDATE public.rag_chunks
SET content_hash = md5(content)
WHERE content_hash IS NULL;


-- ──────────────────────────────────────────────────────────────
--  SECTION 4 — RESET failed / stuck embeddings back to pending
--              so embed-chunks.ts will retry them
-- ──────────────────────────────────────────────────────────────
-- Preview:
SELECT id, embedding_status, embedding_claimed_at
FROM public.rag_chunks
WHERE embedding IS NULL
  AND embedding_status IN ('failed', 'processing');

-- Execute:
UPDATE public.rag_chunks
SET
  embedding_status     = 'pending',
  embedding_claimed_at = NULL
WHERE embedding IS NULL
  AND embedding_status IN ('failed', 'processing');


-- ──────────────────────────────────────────────────────────────
--  SECTION 5 — SEED null embedding_status to 'pending'
--              (rows inserted before migration 001 ran)
-- ──────────────────────────────────────────────────────────────
UPDATE public.rag_chunks
SET embedding_status = CASE
  WHEN embedding IS NOT NULL THEN 'done'
  ELSE 'pending'
END
WHERE embedding_status IS NULL;


-- ──────────────────────────────────────────────────────────────
--  SECTION 6 — DROP rows with both grade AND subject null
--              (unclassifiable — re-ingest the PDF instead)
-- ──────────────────────────────────────────────────────────────
-- Preview:
SELECT
  COUNT(*) AS rows_to_drop,
  metadata->>'filename' AS filename
FROM public.rag_chunks
WHERE (metadata->>'grade'   IS NULL OR metadata->>'grade'   = 'null')
  AND (metadata->>'subject' IS NULL OR metadata->>'subject' = 'null')
GROUP BY metadata->>'filename'
ORDER BY rows_to_drop DESC;

-- Execute:
DELETE FROM public.rag_chunks
WHERE (metadata->>'grade'   IS NULL OR metadata->>'grade'   = 'null')
  AND (metadata->>'subject' IS NULL OR metadata->>'subject' = 'null');


-- ──────────────────────────────────────────────────────────────
--  SECTION 7 — Final health check
-- ──────────────────────────────────────────────────────────────
SELECT
  embedding_status,
  COUNT(*)                                       AS total,
  COUNT(*) FILTER (WHERE embedding IS NULL)      AS missing_vector,
  COUNT(*) FILTER (WHERE source_id IS NULL)      AS missing_source_id
FROM public.rag_chunks
GROUP BY embedding_status
ORDER BY embedding_status;
