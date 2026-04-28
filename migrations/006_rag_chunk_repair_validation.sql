-- ============================================================
-- Migration 006: RAG Chunk Repair & Validation
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rag_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  original_filename text NOT NULL,
  file_path text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/pdf',
  file_size bigint NOT NULL DEFAULT 0,
  extraction_mode text DEFAULT 'text',
  total_pages integer DEFAULT 0,
  title text,
  detected_grade_name text,
  detected_subject_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rag_extraction_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.rag_documents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rag_chunks
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.rag_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_content text,
  ADD COLUMN IF NOT EXISTS page_start integer,
  ADD COLUMN IF NOT EXISTS page_end integer,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS topic_id uuid REFERENCES public.topics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quality_score numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS repair_status text NOT NULL DEFAULT 'clean',
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ocr_detected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_duplicate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_of uuid,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.rag_chunks
SET original_content = content
WHERE original_content IS NULL;

UPDATE public.rag_chunks
SET content_hash = md5(content)
WHERE content_hash IS NULL;

ALTER TABLE public.rag_chunks
  ALTER COLUMN content_hash SET NOT NULL;

CREATE INDEX IF NOT EXISTS rag_chunks_document_idx ON public.rag_chunks(document_id);
CREATE INDEX IF NOT EXISTS rag_chunks_repair_status_idx ON public.rag_chunks(repair_status);
CREATE INDEX IF NOT EXISTS rag_chunks_quality_score_idx ON public.rag_chunks(quality_score);
CREATE INDEX IF NOT EXISTS rag_chunks_ocr_detected_idx ON public.rag_chunks(ocr_detected);
CREATE INDEX IF NOT EXISTS rag_chunks_duplicate_idx ON public.rag_chunks(is_duplicate);
CREATE UNIQUE INDEX IF NOT EXISTS rag_chunks_document_hash_unique
  ON public.rag_chunks(document_id, content_hash);

CREATE TABLE IF NOT EXISTS public.rag_chunk_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id uuid NOT NULL REFERENCES public.rag_chunks(id) ON DELETE CASCADE,
  version_index integer NOT NULL DEFAULT 1,
  content text NOT NULL,
  content_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rag_chunk_versions_chunk_version_unique
  ON public.rag_chunk_versions(chunk_id, version_index);

CREATE TABLE IF NOT EXISTS public.rag_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id uuid NOT NULL REFERENCES public.rag_chunks(id) ON DELETE CASCADE,
  embedding vector(768),
  model text,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rag_embeddings_chunk_idx ON public.rag_embeddings(chunk_id);
CREATE INDEX IF NOT EXISTS rag_embeddings_active_idx ON public.rag_embeddings(is_active);

CREATE TABLE IF NOT EXISTS public.rag_retrieval_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id uuid REFERENCES public.rag_chunks(id) ON DELETE SET NULL,
  query_text text NOT NULL,
  retrieved_chunk_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  retrieved_scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  passed boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rag_jobs_status_idx ON public.rag_extraction_jobs(status);
CREATE INDEX IF NOT EXISTS rag_jobs_document_idx ON public.rag_extraction_jobs(document_id);

CREATE OR REPLACE FUNCTION public.touch_rag_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_touch_rag_documents ON public.rag_documents;
CREATE TRIGGER trigger_touch_rag_documents
BEFORE UPDATE ON public.rag_documents
FOR EACH ROW
EXECUTE FUNCTION public.touch_rag_updated_at();

DROP TRIGGER IF EXISTS trigger_touch_rag_jobs ON public.rag_extraction_jobs;
CREATE TRIGGER trigger_touch_rag_jobs
BEFORE UPDATE ON public.rag_extraction_jobs
FOR EACH ROW
EXECUTE FUNCTION public.touch_rag_updated_at();

DROP TRIGGER IF EXISTS trigger_touch_rag_embeddings ON public.rag_embeddings;
CREATE TRIGGER trigger_touch_rag_embeddings
BEFORE UPDATE ON public.rag_embeddings
FOR EACH ROW
EXECUTE FUNCTION public.touch_rag_updated_at();
