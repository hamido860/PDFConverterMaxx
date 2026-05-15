import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// ── Load classification aliases (typo / variation → canonical DB value) ───────
const ALIASES_PATH = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'classification-aliases.json');
const _aliases = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf8')) as {
    grades:   Record<string, string[]>;
    subjects: Record<string, string[]>;
};

// Build reverse lookup:  normalised-alias → canonical value
function buildReverseMap(map: Record<string, string[]>): Map<string, string> {
    const rev = new Map<string, string>();
    for (const [canonical, variants] of Object.entries(map)) {
        for (const v of variants) {
            rev.set(normaliseToken(v), canonical);
        }
    }
    return rev;
}

function normaliseToken(s: string): string {
    return s.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
        .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')        // keep Arabic chars
        .trim();
}

const GRADE_ALIASES:   Map<string, string> = buildReverseMap(_aliases.grades);
const SUBJECT_ALIASES: Map<string, string> = buildReverseMap(_aliases.subjects);

// ── Levenshtein fuzzy match (no deps) ────────────────────────────────────────
function levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i-1] === b[j-1]
                ? dp[i-1][j-1]
                : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return dp[m][n];
}

function fuzzyLookup(token: string, aliasMap: Map<string, string>, maxDist = 2): string | null {
    if (token.length < 3) return null; // too short for fuzzy
    let best: string | null = null;
    let bestDist = maxDist + 1;
    for (const [alias, canonical] of aliasMap) {
        const d = levenshtein(token, alias);
        if (d <= maxDist && d < bestDist) { bestDist = d; best = canonical; }
    }
    return best;
}

// ── Credentials ───────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ CRITICAL: SUPABASE_URL and SUPABASE_KEY are required in .env!');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Config ────────────────────────────────────────────────────────────────────
const SKIP_EMBEDDING   = process.env.SKIP_EMBEDDING === 'true';
const OPENROUTER_KEYS  = (process.env.OPENROUTER_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || selectCheapestModel();

/**
 * Choose the most cost‑effective model that OpenRouter offers.
 * Currently prefers the free tier (gpt‑4o‑mini) and falls back to a
 * lightweight open‑source model if the free tier is unavailable.
 */
function selectCheapestModel(): string {
  // List of known cheap/free models (ordered by preference)
  const cheapModels = [
    'qwen/qwen2-7b-instruct:free', // free Qwen 7B model – high quality, no cost
    'openai/gpt-4o-mini',          // fallback free tier from OpenAI
    'mistralai/mistral-7b-instruct', // open‑source, low cost fallback
    'openrouter/auto'               // let OpenRouter pick the best if others unavailable
  ];
  // Return the first one – you can customize based on your keys/quotas.
  return cheapModels[0];
}
const EMBEDDING_MODEL  = 'gemini-embedding-2-preview';
const _keyCooldowns = new Map<string, number>(); // track OpenRouter key cooldowns

// Round-robin key rotation with 429 backoff
let _orKeyIndex = 0;
function nextOpenRouterKey(): string {
  // Find a key that is not currently cooling down
  for (let i = 0; i < OPENROUTER_KEYS.length; i++) {
    const idx = (_orKeyIndex + i) % OPENROUTER_KEYS.length;
    const candidate = OPENROUTER_KEYS[idx];
    const cooldown = _keyCooldowns.get(candidate) ?? 0;
    if (Date.now() >= cooldown) {
      _orKeyIndex = idx + 1;
      return candidate;
    }
  }
  // All keys are cooling down – pick the one with the nearest expiry
  let soonestKey = OPENROUTER_KEYS[0];
  let soonestTime = Infinity;
  for (const k of OPENROUTER_KEYS) {
    const t = _keyCooldowns.get(k) ?? 0;
    if (t < soonestTime) { soonestTime = t; soonestKey = k; }
  }
  const wait = Math.max(0, soonestTime - Date.now());
  if (wait > 0) console.warn(`⏳ All OpenRouter keys cooling down, waiting ${Math.round(wait/1000)}s`);
  // Sleep for the required time before returning the key
  // Note: this function is synchronous; the caller will handle awaiting after key selection.
  return soonestKey;
}

const OR_DELAY = 2000; // ms between OpenRouter calls
const _orSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function callOpenRouter(prompt: string): Promise<string> {
    // Configuration for retries
    const MAX_RETRIES = Math.max(OPENROUTER_KEYS.length * 4, 10); // increased attempts
    const BASE_DELAY = 2000; // initial delay between attempts in ms

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const key = nextOpenRouterKey();
        try {
            // Respect a minimum inter-call delay to avoid hitting rate limits aggressively
+            await _orSleep(BASE_DELAY);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30_000); // 30s timeout
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`,
                },
                body: JSON.stringify({
                    model: OPENROUTER_MODEL,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1,
                }),
                signal: controller.signal,
            });
            clearTimeout(timeout);

            // Handle rate limit response
            if (res.status === 429) {
                const retryAfter = parseInt(res.headers.get('retry-after') ?? '10', 10);
                const waitSec = Math.max(retryAfter, 10);
                console.warn(`⚠️ OpenRouter 429 – waiting ${waitSec}s before retry (attempt ${attempt}/${MAX_RETRIES})`);
                // Set cooldown for this key
                _keyCooldowns.set(key, Date.now() + waitSec * 1000);
                await _orSleep(waitSec * 1000);
                continue; // retry with next key
            }

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 200)}`);
            }

            const data = await res.json();
            return data.choices?.[0]?.message?.content ?? '';
        } catch (err: any) {
            // Abort due to network or other errors
            if (attempt >= MAX_RETRIES) {
                console.error(`❌ OpenRouter failed after ${MAX_RETRIES} attempts: ${err.message}`);
                throw err;
            }
            // Set a temporary cooldown for the failing key to avoid immediate reuse
            const cooldownMs = BASE_DELAY * Math.pow(2, attempt - 1);
            _keyCooldowns.set(key, Date.now() + cooldownMs);
            // Exponential backoff with jitter
            const backoff = BASE_DELAY * Math.pow(2, attempt - 1);
            const jitter = Math.random() * 500;
            const delay = backoff + jitter;
            console.warn(`⚠️ OpenRouter attempt ${attempt} error: ${err.message} – retrying in ${Math.round(delay / 1000)}s`);
            await _orSleep(delay);
        }
    }
    // Should never reach here; return empty string as fallback
    return '';
}
const CHUNK_SIZE       = 1200;
const CHUNK_OVERLAP    = 200;
const MIN_CHUNK_LENGTH = 100;   // discard garbage chunks
const EMBED_BATCH_SIZE = 2;     // Reduced to support quality/rate limits

// ── Filename → grade/subject parser ──────────────────────────────────────────
// Handles patterns like: 1bac-biof-svt.pdf, 2bac-math.pdf, tcs-physique.pdf
// ── Grade/Subject maps use EXACT DB values (grades.name / subjects.name) ──────
const GRADE_MAP: Record<string, string> = {
    // Lycée
    'tcs':   'Tronc Commun',
    'tc':    'Tronc Commun',
    '1bac':  '1ère année Bac',
    '1BAC':  '1ère année Bac',
    '2bac':  '2ème année Bac',
    '2BAC':  '2ème année Bac',
    // Collège
    '1col':  '1ère année collège',
    '2col':  '2ème année collège',
    '3col':  '3ème année collège',
    '1c':    '1ère année collège',
    '2c':    '2ème année collège',
    '3c':    '3ème année collège',
    // Primaire
    '1p':    '1ère année primaire',
    '2p':    '2ème année primaire',
    '3p':    '3ème année primaire',
    '4p':    '4ème année primaire',
    '5p':    '5ème année primaire',
    '6p':    '6ème année primaire',
    '1prim': '1ère année primaire',
    '2prim': '2ème année primaire',
    '3prim': '3ème année primaire',
    '4prim': '4ème année primaire',
    '5prim': '5ème année primaire',
    '6prim': '6ème année primaire',
};
const SUBJECT_MAP: Record<string, string> = {
    // Exact DB subject names
    'math':        'Mathématiques',
    'maths':       'Mathématiques',
    'mathematiques': 'Mathématiques',
    'svt':         'Sciences de la Vie et de la Terre (SVT)',
    'biof':        'Sciences de la Vie et de la Terre (SVT)',
    'bio':         'Sciences de la Vie et de la Terre (SVT)',
    'phys':        'Physique-Chimie',
    'physique':    'Physique-Chimie',
    'pc':          'Physique-Chimie',
    'fr':          'Langue Française',
    'francais':    'Langue Française',
    'french':      'Langue Française',
    'arab':        'اللغة العربية',
    'arabe':       'اللغة العربية',
    'arabic':      'اللغة العربية',
    'ang':         'English',
    'anglais':     'English',
    'english':     'English',
    'islam':       'التربية الإسلامية',
    'islamique':   'التربية الإسلامية',
    'hist':        'الاجتماعيات',
    'geo':         'الاجتماعيات',
    'histgeo':     'الاجتماعيات',
    'sociales':    'الاجتماعيات',
    'philo':       'الفلسفة',
    'philosophie': 'الفلسفة',
    'sci':         'النشاط العلمي',
    'sciences':    'النشاط العلمي',
    'info':        'Sciences de l\'Ingénieur',
    'informatique': 'Sciences de l\'Ingénieur',
    'si':          'Sciences de l\'Ingénieur',
    'eco':         'Économie Générale et Statistique',
    'economie':    'Économie Générale et Statistique',
    'compta':      'Comptabilité et Mathématiques Financières',
    'comptabilite': 'Comptabilité et Mathématiques Financières',
    'eoae':        'Économie et Organisation Administrative des Entreprises (EOAE)',
};

function parseFilename(fileName: string): { gradeHint: string | null; topicHint: string | null; subjectHint: string | null } {
    const base = path.basename(fileName, path.extname(fileName));

    // User's regex strategy
    const gradeMatch = fileName.match(/(\d)(bac)/i) || fileName.match(/tcs/i) || fileName.match(/(\d)(col)/i) || fileName.match(/(\d)(p)/i);
    const gradeHint = gradeMatch ? gradeMatch[0].toLowerCase() : null;

    const topicMatch = base.match(/^([^-]+)/);
    const topicHint = topicMatch ? topicMatch[1] : null;

    const slug  = base.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const parts = slug.split('-').filter(Boolean);

    let subjectHint: string | null = null;
    let fallbackGrade: string | null = null;

    // ── Pass 1: exact match on individual tokens ──
    for (const part of parts) {
        if (!fallbackGrade   && GRADE_MAP[part])   fallbackGrade   = GRADE_MAP[part];
        if (!subjectHint && SUBJECT_MAP[part]) subjectHint = SUBJECT_MAP[part];
    }

    // ── Pass 2: match n-grams against alias maps ─────────
    if (!subjectHint) {
        for (let n = 3; n >= 1; n--) {
            for (let i = 0; i <= parts.length - n; i++) {
                const phrase = normaliseToken(parts.slice(i, i + n).join(' '));
                if (!fallbackGrade   && GRADE_ALIASES.has(phrase))   fallbackGrade   = GRADE_ALIASES.get(phrase)!;
                if (!subjectHint && SUBJECT_ALIASES.has(phrase)) subjectHint = SUBJECT_ALIASES.get(phrase)!;
            }
        }
    }

    return { gradeHint: gradeHint || fallbackGrade, topicHint, subjectHint };
}

// ── Chunker ───────────────────────────────────────────────────────────────────
function cleanText(text: string): string {
    return text
        .replace(/[ \t]+/g, ' ')       // collapse inline whitespace
        .replace(/\n{3,}/g, '\n\n')    // max two consecutive newlines
        .trim();
}

function splitIntoChunks(raw: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
    const text   = cleanText(raw);
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
        let end = Math.min(start + size, text.length);

        if (end < text.length) {
            // Prefer paragraph break in the back half of the window
            const paraBreak = text.lastIndexOf('\n\n', end);
            if (paraBreak > start + Math.floor(size / 2)) {
                end = paraBreak;
            } else {
                // Fall back to sentence boundary (supports Arabic ؟)
                const sentBreak = Math.max(
                    text.lastIndexOf('. ',  end),
                    text.lastIndexOf('! ',  end),
                    text.lastIndexOf('? ',  end),
                    text.lastIndexOf('؟ ', end)
                );
                if (sentBreak > start + Math.floor(size / 2)) {
                    end = sentBreak + 1;
                }
                // Otherwise fall through to hard character split
            }
        }

        const chunk = text.substring(start, end).trim();
        if (chunk.length >= MIN_CHUNK_LENGTH) {
            chunks.push(chunk);
        }

        start = end - overlap;
        if (start >= text.length) break;
    }

    return chunks;
}

// ── MD5 helper ────────────────────────────────────────────────────────────────
function md5(text: string): string {
    return crypto.createHash('md5').update(text).digest('hex');
}

// ── Gemini embedding helper ───────────────────────────────────────────────────
const _genai = process.env.GEMINI_API_KEY
    ? new (require('@google/genai').GoogleGenAI)({ apiKey: process.env.GEMINI_API_KEY })
    : null;

async function embedTexts(texts: string[]): Promise<number[][]> {
    if (!_genai) throw new Error('GEMINI_API_KEY not set');
    const results: number[][] = [];
    for (const text of texts) {
        const result = await _genai.models.embedContent({
            model:    EMBEDDING_MODEL,
            contents: text,
            config:   { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 1024 } as any,
        });
        const vector = result.embeddings?.[0]?.values;
        if (!vector || vector.length === 0) throw new Error('Gemini returned empty embedding');
        results.push(Array.from(vector));
    }
    return results;
}

// ── FK resolver ───────────────────────────────────────────────────────────────
// Resolves all FK columns for a chunk in one pass:
//   source_id (topic), grade_id, cycle_id, curriculum_id
interface ResolvedIds {
    sourceId:     string | null;
    gradeId:      string | null;
    cycleId:      string | null;
    curriculumId: string | null;
}

async function resolveIds(gradeHint: string | null, topicHint: string | null, subjectHint: string | null): Promise<ResolvedIds> {
    const empty: ResolvedIds = { sourceId: null, gradeId: null, cycleId: null, curriculumId: null };
    if (!gradeHint && !topicHint && !subjectHint) return empty;

    try {
        // Resolve canonical grade name from aliases
        let gradeName = gradeHint;
        if (gradeHint && GRADE_ALIASES.has(normaliseToken(gradeHint))) {
            gradeName = GRADE_ALIASES.get(normaliseToken(gradeHint))!;
        } else if (gradeHint && GRADE_MAP[gradeHint]) {
            gradeName = GRADE_MAP[gradeHint];
        }

        // Grade row
        const { data: gradeRow } = await supabase
            .from('grades')
            .select('id, cycle_id')
            .ilike('name', gradeName ?? '')
            .maybeSingle();

        const cycleId = gradeRow?.cycle_id ?? null;
        let curriculumId: string | null = null;
        if (cycleId) {
            const { data: cycleRow } = await supabase
                .from('cycles')
                .select('curriculum_id')
                .eq('id', cycleId)
                .maybeSingle();
            curriculumId = cycleRow?.curriculum_id ?? null;
        }

        let sourceId: string | null = null;
        let subjectId: string | null = null;

        // Try to match the exact topic in topics table via topicHint
        if (topicHint) {
            const formattedTopic = topicHint.replace(/[_\-]+/g, ' ');
            let q = supabase.from('topics').select('id, subject_id, grade_id').ilike('title', `%${formattedTopic}%`);
            if (gradeRow) q = q.eq('grade_id', gradeRow.id);
            
            const { data: topicMatches } = await q.limit(1);
            if (topicMatches && topicMatches.length > 0) {
                sourceId = topicMatches[0].id;
                subjectId = topicMatches[0].subject_id;
            }
        }

        // If no topic matched, fall back to matching the subject table
        if (!sourceId && subjectHint) {
            const { data: subjectRow } = await supabase
                .from('subjects')
                .select('id')
                .ilike('name', subjectHint)
                .maybeSingle();
            
            if (subjectRow) {
                subjectId = subjectRow.id;
            }
        }

        // Find a general topic if we only have subject
        if (!sourceId && subjectId && gradeRow) {
            const { data: generalTopic } = await supabase
                .from('topics')
                .select('id')
                .eq('subject_id', subjectId)
                .eq('grade_id', gradeRow.id)
                .limit(1).maybeSingle();
            sourceId = generalTopic?.id ?? null;
        }

        if (!sourceId && !gradeRow?.id) {
            console.warn(`⚠️  resolveIds: no match in DB for grade="${gradeHint}" topic="${topicHint}"`);
        }

        return {
            sourceId,
            gradeId: gradeRow?.id ?? null,
            cycleId,
            curriculumId,
        };
    } catch (err: any) {
        console.error('⚠️  resolveIds failed:', err.message);
        return empty;
    }
}

// ── Return type ──────────────────────────────────────────────────────────────
export type IngestResult =
    | { status: 'success';   inserted: number; embedded: number; skipped: number }
    | { status: 'duplicate'; fileName: string  }
    | { status: 'error';     message:  string  };

// ── Already-ingested guard ────────────────────────────────────────────────────
/**
 * Returns true if at least one rag_chunks row was previously saved for this
 * exact filename (checked against metadata->>'filename' in Supabase).
 */
async function isAlreadyIngested(fileName: string): Promise<boolean> {
    const { data, error } = await supabase
        .from('rag_chunks')
        .select('id')
        .eq('metadata->>filename', fileName)
        .limit(1)
        .maybeSingle();

    if (error) {
        // On query error be conservative — do NOT block the ingest
        console.error(`⚠️ Duplicate-check query failed: ${error.message}`);
        return false;
    }
    return data !== null;
}

// ── Main ingestion flow ───────────────────────────────────────────────────────
export async function ingest(filePath: string): Promise<IngestResult> {
    try {
        const absolutePath = path.resolve(filePath);
        const fileName     = path.basename(filePath);

        console.log(`⏳ Pre-processing: ${fileName}`);

        // ── Already-ingested check (DB-level, survives restarts) ──────────────
        const alreadyDone = await isAlreadyIngested(fileName);
        if (alreadyDone) {
            console.warn(`🚫 REJECTED: "${fileName}" was already ingested. Skipping.`);
            return { status: 'duplicate', fileName };
        }

        const dataBuffer = fs.readFileSync(absolutePath);
        
        let rawText = '';
        try {
            const doc = await pdfjsLib.getDocument({ data: new Uint8Array(dataBuffer) }).promise;
            for (let i = 1; i <= doc.numPages; i++) {
                const page = await doc.getPage(i);
                const content = await page.getTextContent();
                const pageText = content.items.map((item: any) => item.str).join(' ');
                rawText += pageText + '\n\n';
                page.cleanup();
            }
            doc.destroy();
        } catch (pdfErr: any) {
            console.error(`❌ PDF parse failed for ${fileName}:`, pdfErr.message);
            return { status: 'error', message: pdfErr.message };
        }

        let washedText = rawText.replace(/[\u0000\x00]/g, '').trim();

        if (washedText.length < 50) {
            console.log(`⏩ Skipping ${fileName} (too little content).`);
            markDone(absolutePath);
            return { status: 'success', inserted: 0, embedded: 0, skipped: 0 };
        }

        // FIX #4 — parse grade/topic/subject from filename first
        let { gradeHint, topicHint, subjectHint } = parseFilename(fileName);
        console.log(`📂 Filename parse → grade: [${gradeHint ?? '?'}], topic: [${topicHint ?? '?'}], subject: [${subjectHint ?? '?'}]`);

        // Resolve all FK IDs once per document using the new resolveIds
        const { sourceId, gradeId, cycleId, curriculumId } = await resolveIds(gradeHint, topicHint, subjectHint);
        console.log(`🔗 source_id=${sourceId ?? 'null'}  grade_id=${gradeId ?? 'null'}  cycle_id=${cycleId ?? 'null'}  curriculum_id=${curriculumId ?? 'null'}`);

        // Specialized Text Formatting via AI (Math & Islamic Education)
        if (subjectHint === 'Mathématiques' || subjectHint === 'التربية الإسلامية') {
            console.log(`🤖 Specialized formatting for ${subjectHint}...`);
            const isMath = subjectHint === 'Mathématiques';
            const formattingPrompt = isMath 
                ? `You are an expert Math text formatter. Clean up the following extracted PDF text. Convert garbled math symbols into proper LaTeX format enclosed in $ or $$. Do not summarize, just format:\n\n"""${washedText.substring(0, 3000)}"""`
                : `You are an expert in Islamic Education texts. Clean up the following extracted PDF text. Ensure Quranic verses are properly enclosed in ﴾ ﴿ and Hadiths are clear with correct Tashkeel. Do not summarize:\n\n"""${washedText.substring(0, 3000)}"""`;
            
            try {
                const formatted = await callOpenRouter(formattingPrompt);
                if (formatted && formatted.length > 50) {
                    washedText = formatted.trim();
                    console.log(`✅ Text formatted via OpenRouter (${washedText.length} chars)`);
                }
            } catch (e: any) {
                console.error(`⚠️ AI Formatting failed: ${e.message}. Continuing with raw text.`);
            }
        }

        console.log(`🎯 Final classification → gradeId: [${gradeId ?? 'null'}], sourceId: [${sourceId ?? 'null'}]`);



        // Split into chunks (FIX #5 — min-length filter is inside splitIntoChunks)
        const chunks = splitIntoChunks(washedText);
        console.log(`🧠 ${chunks.length} chunks after garbage filter. Syncing to Supabase…`);

        let inserted = 0;
        let skipped  = 0;
        let embedded = 0;

        // Process in small batches so we can embed before inserting
        for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
            const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);

            // ── FIX #1: dedup via MD5 hash ───────────────────────────────────
            const hashes         = batch.map(md5);
            const newChunks:    string[]   = [];
            const newHashes:    string[]   = [];

            for (let k = 0; k < batch.length; k++) {
                const { data: existing } = await supabase
                    .from('rag_chunks')
                    .select('id')
                    .eq('content_hash', hashes[k])
                    .maybeSingle();

                if (existing) {
                    skipped++;
                } else {
                    newChunks.push(batch[k]);
                    newHashes.push(hashes[k]);
                }
            }

            if (newChunks.length === 0) continue;

            // ── Embed before insert (skipped if SKIP_EMBEDDING=true) ──────────
            let vectors: number[][] | null = null;
            if (!SKIP_EMBEDDING) {
                try {
                    vectors = await embedTexts(newChunks);
                    embedded += vectors.length;
                    console.log(`   🔢 Embedded ${vectors.length} chunk(s) in batch ${Math.floor(i / EMBED_BATCH_SIZE) + 1}`);
                } catch (embErr: any) {
                    console.error(`   ⚠️ Gemini embedding failed for batch: ${embErr.message}. Inserting without embeddings.`);
                }
            }

            // ── Insert each chunk ─────────────────────────────────────────────
            for (let j = 0; j < newChunks.length; j++) {
                const chunkIndex = i + j;
                const { error: ragError } = await supabase.from('rag_chunks').insert({
                    // ── Core content ──────────────────────────────────────────
                    content:              newChunks[j],
                    content_hash:         newHashes[j],          // NOT NULL (migration 005)
                    embedding:            vectors ? vectors[j] : null,
                    embedding_status:     vectors ? 'done' : 'pending',
                    embedding_model:      vectors ? 'gemini-embedding-2-preview' : null,

                    // ── Source linkage ────────────────────────────────────────
                    source_type:          'lesson_block',
                    source_id:            sourceId,

                    // ── Classification columns (top-level, NOT just metadata) ─
                    grade_id:             gradeId,               // migration 004
                    cycle_id:             cycleId,               // migration 004
                    curriculum_id:        curriculumId,          // migration 004

                    // ── Chunk position metadata (NOT NULL — migration 005) ────
                    chunk_index:          chunkIndex,
                    chunk_size:           newChunks[j].length,

                    // ── Processing state ──────────────────────────────────────
                    is_processed:         !!vectors,
                    processed_at:         vectors ? new Date().toISOString() : null,

                    // ── JSON metadata (kept for backward-compat) ──────────────
                    metadata: {
                        filename:       fileName,
                        gradeHint,
                        topicHint,
                        subjectHint,
                        autoClassified: true,
                        timestamp:      new Date().toISOString(),
                    },
                });

                if (ragError) {
                    // Unique-constraint violation means a race-condition duplicate — treat as skip
                    if (ragError.code === '23505') {
                        skipped++;
                    } else {
                        console.error(`❌ DB sync failed for chunk ${chunkIndex}:`, ragError.message);
                    }
                } else {
                    inserted++;
                }
            }
            
            // Sleep delay to prevent rate limits and support quality
            await _orSleep(2000);
        }

        console.log(
            `✅ Flow complete for ${fileName}.\n` +
            `   Inserted: ${inserted}  |  Embedded: ${embedded}  |  Skipped duplicates: ${skipped}`
        );
        markDone(absolutePath);
        return { status: 'success', inserted, embedded, skipped };

    } catch (err: any) {
        console.error(`📛 Pipeline crashed for "${filePath}": ${err.message}`);
        if (err.stack) console.error(err.stack);

        // Rename crashed file to .error.pdf so it won't be retried on next run
        try {
            const absolutePath = path.resolve(filePath);
            if (absolutePath.toLowerCase().endsWith('.pdf')) {
                const errorPath = absolutePath.replace(/\.pdf$/i, '.error.pdf');
                fs.renameSync(absolutePath, errorPath);
                console.warn(`⚠️  Moved crashed file to: ${path.basename(errorPath)}`);
            }
        } catch {
            // File may already be moved/deleted — not blocking
        }

        return { status: 'error', message: err.message };
    }
}

// ── Mark file as done ─────────────────────────────────────────────────────────
function markDone(absolutePath: string): void {
    if (!absolutePath.endsWith('.pdf')) return;
    const donePath = absolutePath.replace(/\.pdf$/i, '.done.pdf');
    try {
        fs.renameSync(absolutePath, donePath);
    } catch {
        // File may have been moved or deleted externally — not a blocking error
    }
}
