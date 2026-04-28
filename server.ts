import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import { ingest, type IngestResult } from "./rag-ingest";
import { spawn } from "child_process";
import { createClient } from "@supabase/supabase-js";
import { processRagExtractionJob } from "./services/rag/pipeline";
import { embeddingService } from "./services/rag/embeddingService";
import { openRouterRepairService } from "./services/rag/openRouterRepairService";
import { retrievalTestService } from "./services/rag/retrievalTestService";
import { supabaseRagService } from "./services/rag/supabaseRagService";
import 'dotenv/config';

const supabase = createClient(
    process.env.SUPABASE_URL  || '',
    process.env.SUPABASE_KEY  || ''
);

export const app = express();
app.use(cors()); // harmless when mounted in Vite (same-origin); kept for STANDALONE_API mode
app.use(express.json());

const PDF_DIR    = path.resolve(process.env.WATCH_DIR ?? "./auto_ingest_pdfs");
const EMBED_LOG  = path.join(process.cwd(), "embed-agent.log");
let   embedderPid: number | null = null;

if (!fs.existsSync(PDF_DIR)) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
}
console.log(`ðŸ“‚ Watch directory: ${PDF_DIR}`);

const processed = new Set<string>();
const RAG_UPLOAD_DIR = path.join(PDF_DIR, "_rag_review");

if (!fs.existsSync(RAG_UPLOAD_DIR)) {
  fs.mkdirSync(RAG_UPLOAD_DIR, { recursive: true });
}

function launchRagJob(jobId: string, documentId: string, filePath: string) {
  void processRagExtractionJob(jobId, documentId, filePath).catch((error: any) => {
    console.error(`[rag-repair] Job ${jobId} failed:`, error.message);
  });
}

// â”€â”€ Sanitize a path to ensure it stays inside PDF_DIR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function safeResolvePdf(input: string): string | null {
  const resolved = path.resolve(input);
  if (!resolved.startsWith(PDF_DIR + path.sep) && resolved !== PDF_DIR) return null;
  if (!resolved.endsWith('.pdf') || resolved.endsWith('.done.pdf') || resolved.endsWith('.error.pdf')) return null;
  return resolved;
}

// Auto-watch folder â€” log newly-added PDFs so the user can see them land on disk.
// Ingest is driven by the React UI poller (GET /api/auto-ingest â†’ /api/download â†’ /api/mark-done),
// NOT by this watcher â€” otherwise the two race and the server wins by renaming files to
// `.done.pdf` before the frontend can fetch them, which makes auto-ingest look broken in the UI.
// (chokidar v5 recurses by default â€” no `recursive` option needed.)
chokidar.watch(PDF_DIR, { ignoreInitial: true }).on("add", (filePath) => {
  if (!filePath.endsWith(".pdf")) return;
  if (filePath.endsWith(".done.pdf")) return;
  if (filePath.endsWith(".error.pdf")) return;
  console.log(`ðŸ“„ New PDF detected (UI will pick it up on next poll): ${filePath}`);
});

// Manual trigger from UI
app.post("/ingest", async (req, res) => {
  const { filePath } = req.body;
  const safe = filePath ? safeResolvePdf(filePath) : null;
  if (!safe || !fs.existsSync(safe)) {
    return res.status(400).json({ error: "File not found or outside watch directory" });
  }
  const result: IngestResult = await ingest(safe);
  if (result.status === 'duplicate') {
    return res.status(409).json({
      error: `"${result.fileName}" has already been ingested. Remove it from the DB first if you want to re-ingest.`
    });
  }
  if (result.status === 'error') {
    return res.status(500).json({ error: result.message });
  }
  res.json({ success: true, ...result });
});

// Upload PDF from browser
app.post("/upload", express.raw({ type: "application/pdf", limit: "50mb" }), async (req, res) => {
  const fileName = req.headers["x-filename"] as string || `upload-${Date.now()}.pdf`;
  const filePath = path.join(PDF_DIR, fileName);

  // â”€â”€ Reject duplicate BEFORE writing to disk â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Check if the file already exists on disk (same filename)
  if (fs.existsSync(filePath) || fs.existsSync(filePath.replace(/\.pdf$/i, '.done.pdf'))) {
    return res.status(409).json({
      error: `"${fileName}" already exists on disk. Rename the file or delete the existing one first.`
    });
  }

  // Write to disk, then run ingest (which will also do the DB-level check)
  fs.writeFileSync(filePath, req.body);
  console.log(`ðŸ“¥ Uploaded: ${fileName}`);

  const result: IngestResult = await ingest(filePath);

  if (result.status === 'duplicate') {
    // DB already had this file â€” clean up the file we just wrote
    try { fs.unlinkSync(filePath); } catch {}
    return res.status(409).json({
      error: `"${fileName}" has already been ingested previously. The upload was rejected.`
    });
  }
  if (result.status === 'error') {
    return res.status(500).json({ error: result.message });
  }

  res.json({ success: true, fileName, ...result });
});

// Status â€” list processed files
app.get("/status", (req, res) => {
  const files = fs.readdirSync(PDF_DIR).filter(f => f.endsWith(".pdf"));
  res.json({ files, processed: [...processed] });
});

// Diagnostic endpoint â€” check if environment variables are loaded
app.get('/api/config-check', (req, res) => {
  res.json({
    supabase_url_loaded: !!process.env.SUPABASE_URL,
    supabase_key_loaded: !!process.env.SUPABASE_KEY,
    gemini_api_key_loaded: !!process.env.GEMINI_API_KEY,
    supabase_url_starts_with: process.env.SUPABASE_URL?.substring(0, 20),
    node_env: process.env.NODE_ENV,
    cwd: process.cwd(),
  });
});

// Recursively collect all .pdf files (not .done.pdf or .error.pdf) as relative paths
function collectPdfs(dir: string, base: string = ''): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectPdfs(path.join(dir, entry.name), rel));
    } else if (entry.isFile() && entry.name.endsWith('.pdf') && !entry.name.endsWith('.done.pdf') && !entry.name.endsWith('.error.pdf')) {
      results.push(rel);
    }
  }
  return results;
}

const rawIngestDir = path.resolve(process.cwd(), PDF_DIR);
const normIngestDir = rawIngestDir.replace(/\\/g, '/');

// â”€â”€ VITE DECOUPLED ROUTES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/auto-ingest', (req, res) => {
  const files = collectPdfs(rawIngestDir);
  res.json({ files });
});

app.get('/api/download', (req, res) => {
  const file = req.query.file as string;
  if (file && file.endsWith('.pdf') && !file.includes('..')) {
      const filePath = path.join(rawIngestDir, file);
      const normFilePath = filePath.replace(/\\/g, '/');
      const exists = fs.existsSync(filePath);
      console.log(`[auto-ingest] download: "${normFilePath}" exists=${exists}`);

      if (normFilePath.startsWith(normIngestDir) && exists) {
        const content = fs.readFileSync(filePath);
        res.setHeader('Content-Type', 'application/pdf');
        return res.send(content);
      }
  }
  res.status(404).end();
});

app.post('/api/mark-done', (req, res) => {
  const file = req.query.file as string;
  if (file && file.endsWith('.pdf') && !file.includes('..')) {
    const oldPath = path.join(rawIngestDir, file);
    const normOldPath = oldPath.replace(/\\/g, '/');
    const newPath = oldPath.replace(/\.pdf$/i, '.done.pdf');
    const exists = fs.existsSync(oldPath);
    console.log(`[auto-ingest] mark-done: "${normOldPath}" exists=${exists}`);

    if (normOldPath.startsWith(normIngestDir) && exists) {
      fs.renameSync(oldPath, newPath);
      return res.json({ success: true });
    }
  }
  res.status(400).end();
});

app.post('/api/run-embedder', (req, res) => {
  // Prevent double-start
  if (embedderPid !== null) {
    try {
      process.kill(embedderPid, 0); // signal 0 = check alive without killing
      return res.status(409).json({ error: 'Embedding agent is already running', pid: embedderPid });
    } catch {
      embedderPid = null; // process is gone â€” allow restart
    }
  }

  // Log environment variables for debugging
  console.log('[embed-agent] Environment check:');
  console.log(`  SUPABASE_URL: ${process.env.SUPABASE_URL ? 'âœ“ SET' : 'âœ— MISSING'}`);
  console.log(`  SUPABASE_KEY: ${process.env.SUPABASE_KEY ? 'âœ“ SET' : 'âœ— MISSING'}`);
  console.log(`  GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'âœ“ SET' : 'âœ— MISSING'}`);

  const logStream = fs.createWriteStream(EMBED_LOG, { flags: 'w' });
  logStream.write(`[START] ${new Date().toISOString()}\n`);
  logStream.write(`[CONFIG] SUPABASE_URL=${process.env.SUPABASE_URL ? 'âœ“' : 'âœ—'}\n`);
  logStream.write(`[CONFIG] SUPABASE_KEY=${process.env.SUPABASE_KEY ? 'âœ“' : 'âœ—'}\n`);
  logStream.write(`[CONFIG] GEMINI_API_KEY=${process.env.GEMINI_API_KEY ? 'âœ“' : 'âœ—'}\n`);

  const child = spawn('npx', ['tsx', 'embed-chunks.ts'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env }, // explicitly pass parent environment
    shell: true,             // required on Windows â€” npx is npx.cmd
  });

  embedderPid = child.pid ?? null;
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  let responded = false;

  child.on('exit', (code) => {
    embedderPid = null;
    const msg = `[EXIT] code=${code ?? '?'}  at ${new Date().toISOString()}\n`;
    logStream.write(msg);
    logStream.end();
    console.log(`[embed-agent] ${msg.trim()}`);
  });

  child.on('error', (err) => {
    embedderPid = null;
    logStream.write(`[ERROR] ${err.message}\n`);
    logStream.end();
    console.error('[embed-agent] spawn error:', err.message);
    if (!responded) {
      responded = true;
      return res.status(500).json({ error: `Failed to spawn embedder: ${err.message}` });
    }
  });

  console.log(`[embed-agent] Started â€” pid=${child.pid}  log=${EMBED_LOG}`);
  responded = true;
  res.json({ success: true, message: 'Embedding agent launched', pid: child.pid });
});

// Embedding status â€” counts by embedding_status from Supabase
app.get('/api/embed-status', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('rag_chunks')
      .select('embedding_status');

    if (error) return res.status(500).json({ error: error.message });

    const counts: Record<string, number> = {};
    for (const row of (data ?? [])) {
      const s = row.embedding_status ?? 'null';
      counts[s] = (counts[s] ?? 0) + 1;
    }

    res.json({
      running: embedderPid !== null,
      pid:     embedderPid,
      counts,
      total:   (data ?? []).length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Tail the embed-agent log (last 150 lines)
app.get('/api/embed-log', (_req, res) => {
  if (!fs.existsSync(EMBED_LOG)) {
    return res.json({ running: embedderPid !== null, lines: [] });
  }
  const raw   = fs.readFileSync(EMBED_LOG, 'utf8');
  const lines = raw.split('\n').filter(Boolean).slice(-150);
  res.json({ running: embedderPid !== null, pid: embedderPid, lines });
});

// RAG Chunk Repair & Validation API
app.post('/api/rag/upload', express.raw({ type: "application/pdf", limit: "100mb" }), async (req, res) => {
  try {
    const fileName = (req.headers["x-filename"] as string) || `rag-upload-${Date.now()}.pdf`;
    const safeName = path.basename(fileName).replace(/[^\w.\-\s\u0600-\u06FF]/g, '_');
    const filePath = path.join(RAG_UPLOAD_DIR, safeName);

    fs.writeFileSync(filePath, req.body);

    const { document, job } = await supabaseRagService.createDocumentAndJob({
      originalFilename: safeName,
      filePath,
      fileSize: Buffer.byteLength(req.body),
      mimeType: 'application/pdf',
    });

    launchRagJob(job.id, document.id, filePath);
    res.json({ success: true, document, job });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/rag/metadata-options', async (_req, res) => {
  try {
    const data = await supabaseRagService.listMetadataOptions();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/rag/jobs', async (_req, res) => {
  try {
    const jobs = await supabaseRagService.listJobs();
    res.json({ jobs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rag/jobs/:jobId/retry', async (req, res) => {
  try {
    const { jobId } = req.params;
    const client = supabaseRagService.client;
    const { data: job, error } = await client
      .from('rag_extraction_jobs')
      .select('id, document_id, retry_count, rag_documents!inner(id, file_path)')
      .eq('id', jobId)
      .single();

    if (error || !job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    await supabaseRagService.updateJob(jobId, {
      status: 'pending',
      retry_count: (job.retry_count ?? 0) + 1,
      error_message: null,
      completed_at: null,
    });
    await supabaseRagService.appendJobLog(jobId, `Retry requested from admin UI${req.body?.stage ? ` for stage ${req.body.stage}` : ''}.`);

    launchRagJob(jobId, job.document_id, (job as any).rag_documents.file_path);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/rag/chunks', async (req, res) => {
  try {
    const chunks = await supabaseRagService.listChunks({
      documentId: typeof req.query.document === 'string' ? req.query.document : undefined,
      gradeId: typeof req.query.grade === 'string' ? req.query.grade : undefined,
      subjectId: typeof req.query.subject === 'string' ? req.query.subject : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      minQualityScore: typeof req.query.quality_score === 'string' ? Number(req.query.quality_score) : undefined,
      ocrDetected: req.query.ocr_detected === 'true' ? true : req.query.ocr_detected === 'false' ? false : undefined,
      duplicate: req.query.duplicate === 'true' ? true : req.query.duplicate === 'false' ? false : undefined,
    });
    res.json({ chunks });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/rag/chunks/:chunkId', async (req, res) => {
  try {
    const chunk = await supabaseRagService.getChunk(req.params.chunkId);
    res.json(chunk);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rag/chunks/:chunkId/save', async (req, res) => {
  try {
    const body = req.body || {};
    const chunk = await supabaseRagService.saveChunkEdits({
      chunkId: req.params.chunkId,
      content: body.content,
      title: body.title,
      language: body.language,
      pageStart: body.page_start,
      pageEnd: body.page_end,
      gradeId: body.grade_id,
      subjectId: body.subject_id,
      topicId: body.topic_id,
      topicTitle: body.topic_title,
      gradeName: body.grade_name,
      subjectName: body.subject_name,
      metadata: body.metadata,
      repairStatus: body.repair_status,
      reviewNotes: body.review_notes,
    });
    try {
      const embedding = await embeddingService.embedText(chunk.content);
      await supabaseRagService.saveEmbedding(chunk.id, embedding, process.env.RAG_EMBEDDING_MODEL || 'gemini-embedding-exp-03-07');
    } catch (embeddingError: any) {
      await supabaseRagService.markEmbeddingFailed(chunk.id, embeddingError.message);
    }
    res.json({ success: true, chunk });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rag/chunks/:chunkId/accept', async (req, res) => {
  try {
    const body = req.body || {};
    const chunk = await supabaseRagService.saveChunkEdits({
      chunkId: req.params.chunkId,
      content: body.content,
      title: body.title,
      language: body.language,
      pageStart: body.page_start,
      pageEnd: body.page_end,
      gradeId: body.grade_id,
      subjectId: body.subject_id,
      topicId: body.topic_id,
      topicTitle: body.topic_title,
      gradeName: body.grade_name,
      subjectName: body.subject_name,
      metadata: {
        ...(body.metadata ?? {}),
        accepted_at: new Date().toISOString(),
      },
      repairStatus: 'auto_repaired',
      reviewNotes: body.review_notes,
    });
    try {
      const embedding = await embeddingService.embedText(chunk.content);
      await supabaseRagService.saveEmbedding(chunk.id, embedding, process.env.RAG_EMBEDDING_MODEL || 'gemini-embedding-exp-03-07');
    } catch (embeddingError: any) {
      await supabaseRagService.markEmbeddingFailed(chunk.id, embeddingError.message);
    }
    res.json({ success: true, chunk });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rag/chunks/:chunkId/reject', async (req, res) => {
  try {
    await supabaseRagService.rejectChunk(req.params.chunkId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rag/chunks/:chunkId/repair', async (req, res) => {
  try {
    const { chunk } = await supabaseRagService.getChunk(req.params.chunkId);
    const metadata = chunk.metadata ?? {};
    const repair = await openRouterRepairService.repairChunk({
      originalContent: chunk.original_content || chunk.content,
      currentContent: chunk.content,
      gradeName: req.body?.grade_name ?? null,
      subjectName: req.body?.subject_name ?? null,
      title: chunk.title,
      flags: metadata.quality_flags ?? [],
      pageStart: chunk.page_start,
      pageEnd: chunk.page_end,
    });

    const updated = await supabaseRagService.saveChunkEdits({
      chunkId: chunk.id,
      content: repair.repairedContent,
      title: repair.suggestedTitle ?? chunk.title,
      language: repair.detectedLanguage ?? chunk.language,
      metadata: {
        ...metadata,
        repair_notes: repair.repairNotes,
        suggested_metadata: repair.suggestedMetadata,
        generated_content: repair.generatedContent,
      },
      repairStatus: 'auto_repaired',
      reviewNotes: repair.repairNotes,
    });

    res.json({ success: true, chunk: updated, repair });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rag/chunks/:chunkId/reembed', async (req, res) => {
  try {
    const { chunk } = await supabaseRagService.getChunk(req.params.chunkId);
    const embedding = await embeddingService.embedText(chunk.content);
    await supabaseRagService.saveEmbedding(chunk.id, embedding, process.env.RAG_EMBEDDING_MODEL || 'gemini-embedding-exp-03-07');
    res.json({ success: true });
  } catch (error: any) {
    try {
      await supabaseRagService.markEmbeddingFailed(req.params.chunkId, error.message);
    } catch {}
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rag/chunks/:chunkId/test-retrieval', async (req, res) => {
  try {
    const result = await retrievalTestService.testChunkRetrieval({
      chunkId: req.params.chunkId,
      queryText: req.body?.query_text,
      documentId: req.body?.document_id ?? null,
    });
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
// â”€â”€ BACKGROUND AUTO-INGEST LOOP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let isBackgroundIngesting = false;
setInterval(async () => {
  if (isBackgroundIngesting) return;
  isBackgroundIngesting = true;
  try {
    const files = collectPdfs(rawIngestDir);
    // Process files one by one
    for (const file of files) {
      const absolutePath = path.join(rawIngestDir, file);
      if (fs.existsSync(absolutePath)) {
        console.log(`[auto-ingest] Background processing started for: ${file}`);
        const result = await ingest(absolutePath);
        
        // ingest() natively marks it as .done.pdf on 'success' or .error.pdf on crash.
        // However, if it returns 'duplicate', it skips renaming it. We need to rename it manually 
        // to prevent infinite loops.
        if (result.status === 'duplicate') {
           const donePath = absolutePath.replace(/\.pdf$/i, '.done.pdf');
           try { fs.renameSync(absolutePath, donePath); console.log(`[auto-ingest] Marked duplicate as done: ${file}`); } catch {}
        }
      }
    }
  } catch (err: any) {
    console.error('[auto-ingest] Background loop error:', err.message);
  } finally {
    isBackgroundIngesting = false;
  }
}, 5000); // Poll every 5 seconds

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Listen mode is OPT-IN. By default this module just exports `app`, and Vite
// mounts it as middleware on the same port as the UI (see vite.config.ts).
// Set STANDALONE_API=true to run the API as its own server on SERVER_PORT.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3333);

function startServer(port: number): void {
  const server = app.listen(port, () => {
    console.log(`ðŸš€ RAG server (standalone) running on http://localhost:${port}`);
    console.log(`ðŸ“‚ Watching directory: ${path.resolve(PDF_DIR)} (recursive)`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\nâŒ Port ${port} is already in use.\n` +
        `   Free it, or set SERVER_PORT to another value.\n` +
        `   (Or just run \`npm run dev\` â€” the API runs inside Vite, no port conflict.)\n`
      );
      process.exit(1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
}

if (process.env.STANDALONE_API === 'true') {
  startServer(SERVER_PORT);
}

