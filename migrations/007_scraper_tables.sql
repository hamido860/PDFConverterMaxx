CREATE TABLE public.scraper_sources (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    url text NOT NULL UNIQUE,
    url_hash text NOT NULL UNIQUE,
    status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'failed')),
    last_scraped_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT scraper_sources_pkey PRIMARY KEY (id)
);

CREATE TABLE public.scraped_pdf_candidates (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    source_id uuid REFERENCES public.scraper_sources(id) ON DELETE SET NULL,
    source_url text NOT NULL,
    pdf_url text NOT NULL UNIQUE,
    url_hash text NOT NULL UNIQUE,
    filename text NOT NULL,
    detected_title text,
    grade_name text,
    subject_name text,
    topic_title text,
    language text,
    status text DEFAULT 'discovered' CHECK (status IN ('discovered', 'approved', 'rejected', 'downloaded', 'queued', 'failed')),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT scraped_pdf_candidates_pkey PRIMARY KEY (id)
);

CREATE TABLE public.scraped_pdf_decisions (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    candidate_id uuid NOT NULL REFERENCES public.scraped_pdf_candidates(id) ON DELETE CASCADE,
    decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
    decided_by uuid REFERENCES auth.users(id),
    decision_reason text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT scraped_pdf_decisions_pkey PRIMARY KEY (id)
);

-- Indexes for fast querying
CREATE INDEX idx_scraper_sources_url_hash ON public.scraper_sources(url_hash);
CREATE INDEX idx_scraped_pdf_candidates_url_hash ON public.scraped_pdf_candidates(url_hash);
CREATE INDEX idx_scraped_pdf_candidates_status ON public.scraped_pdf_candidates(status);

-- Optional: Enable RLS on new tables (if clients need to query them securely)
ALTER TABLE public.scraper_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scraped_pdf_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scraped_pdf_decisions ENABLE ROW LEVEL SECURITY;

-- Create policies for RLS (assuming public can select but only authenticated can insert/update for now, or just allow all for the purpose of this internal pipeline app)
CREATE POLICY "Allow all operations for authenticated users on scraper_sources" ON public.scraper_sources FOR ALL USING (true);
CREATE POLICY "Allow all operations for authenticated users on scraped_pdf_candidates" ON public.scraped_pdf_candidates FOR ALL USING (true);
CREATE POLICY "Allow all operations for authenticated users on scraped_pdf_decisions" ON public.scraped_pdf_decisions FOR ALL USING (true);
