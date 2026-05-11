# PDFConverterMaxx

PDFConverterMaxx is a trusted, automated PDF-to-RAG pipeline explicitly designed for processing Moroccan curriculum content. It provides an end-to-end workflow starting from PDF ingestion (and optional web scraping) through extraction, chunking, AI-assisted cleanup, human review, and finally embedding and syncing with a Supabase vector database.

## Features & Workflow
1. **Upload & Scraper:** Upload local PDFs or discover them on the web to queue for extraction.
2. **Extraction Jobs:** Automatically process PDFs via robust chunking and OCR, keeping track of job statuses.
3. **Chunk Review:** A dedicated interface to review chunks, examine AI-generated repairs, and approve or reject content.
4. **Supabase Publish:** Ensure accepted, quality-controlled chunks are deterministically hashed, embedded, and published to the `rag_chunks` database securely.

## Environment Variables
Create a `.env` file in the root of the project with the following:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
GEMINI_API_KEY=your_gemini_api_key
OPENROUTER_KEY=your_openrouter_api_key

# Directory to watch for automatic PDF ingestion
WATCH_DIR=auto_ingest_pdfs

# Disable automatic directory watch and ingestion process
DISABLE_AUTO_INGEST=false
```

## Running the Application
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server and the backend API:
   ```bash
   npm start
   ```

*(Note: Production users should not expose Supabase service keys to the frontend. PDFConverterMaxx has been architected to funnel sensitive operations through the local backend.)*
