-- ============================================================
--  Migration/Cleanup: Remove Null Classification RAG Chunks
-- ============================================================
--
--  Run this in the Supabase SQL Editor to wipe out all chunks
--  that were ingested with a null grade or null subject.
--  This provides a clean slate so you can re-ingest the PDFs
--  with the updated AI Prompt.
-- ============================================================

-- Step 1: See how many chunks are about to be deleted (Optional safety check)
SELECT COUNT(*) AS chunks_to_delete
FROM public.rag_chunks
WHERE 
  (metadata->>'grade' IS NULL OR metadata->>'grade' = 'null')
  OR 
  (metadata->>'subject' IS NULL OR metadata->>'subject' = 'null');

-- Step 2: Delete the corrupted chunks
DELETE FROM public.rag_chunks
WHERE 
  (metadata->>'grade' IS NULL OR metadata->>'grade' = 'null')
  OR 
  (metadata->>'subject' IS NULL OR metadata->>'subject' = 'null');

-- Step 3: Verify the remaining valid chunks
SELECT COUNT(*) AS valid_chunks_remaining
FROM public.rag_chunks;
