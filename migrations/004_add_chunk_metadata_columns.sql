-- ============================================================
--  Migration: Add missing chunk metadata columns
-- ============================================================
--
--  Run this once in Supabase SQL Editor (Dashboard → SQL Editor)
--  to add timestamps and classification columns to rag_chunks.
--
--  New columns:
--    updated_at          TIMESTAMPTZ  — last modified timestamp
--    grade_id            UUID         — grade classification
--    cycle_id            UUID         — curriculum cycle
--    curriculum_id       UUID         — curriculum reference
--    chunk_index         INTEGER      — position in document
--    chunk_size          INTEGER      — character length
-- ============================================================

-- 1. Add updated_at timestamp column
ALTER TABLE public.rag_chunks
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- 2. Add classification columns
ALTER TABLE public.rag_chunks
  ADD COLUMN IF NOT EXISTS grade_id UUID;

ALTER TABLE public.rag_chunks
  ADD COLUMN IF NOT EXISTS cycle_id UUID;

ALTER TABLE public.rag_chunks
  ADD COLUMN IF NOT EXISTS curriculum_id UUID;

-- 3. Add chunk metadata columns
ALTER TABLE public.rag_chunks
  ADD COLUMN IF NOT EXISTS chunk_index INTEGER;

ALTER TABLE public.rag_chunks
  ADD COLUMN IF NOT EXISTS chunk_size INTEGER;

-- 4. Create trigger to auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION update_rag_chunks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_rag_chunks_updated_at ON public.rag_chunks;

CREATE TRIGGER trigger_update_rag_chunks_updated_at
BEFORE UPDATE ON public.rag_chunks
FOR EACH ROW
EXECUTE FUNCTION update_rag_chunks_updated_at();

-- ============================================================
--  Verify
-- ============================================================
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'rag_chunks'
ORDER BY ordinal_position;
