/**
 * generate-qa.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Q&A pair generator for rag_chunks that already have embeddings.
 *
 * Pipeline per chunk:
 *   1. Call OpenRouter (google/gemini-flash-1.5-8b) → generate N questions + answers
 *   2. Call Gemini embedding → embed each question text (1024 dims)
 *   3. Upsert into rag_questions table
 *
 * The rag_questions table stores pre-computed Q&A pairs so the chatbot can do
 * fast semantic search on questions (student asks → match stored question →
 * return stored answer + source chunk).
 *
 * Rate limits:
 *   - OpenRouter: ~200 RPM on free tier (across 4 keys = 800 RPM effective)
 *   - Gemini embeddings: 60 RPM per key, 1500 RPD per key
 *
 * Grade priority: 2ème Bac → 1ère Bac → … → 1ère primaire (same as embed-chunks)
 *
 * Run once:     npx tsx generate-qa.ts
 * Run as loop:  LOOP=true npx tsx generate-qa.ts
 * Single grade: GRADE="2ème année Bac" npx tsx generate-qa.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

const GEMINI_KEYS = (process.env.GEMINI_API_KEY || '')
    .split(',').map(k => k.trim()).filter(Boolean);

const OPENROUTER_KEYS = (process.env.OPENROUTER_KEY || '')
    .split(',').map(k => k.trim()).filter(Boolean);

const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'qwen/qwen3-next-80b-a3b-instruct:free';
const EMBEDDING_MODEL  = 'gemini-embedding-2-preview';
const OUTPUT_DIMS      = 1024;

// How many Q&A pairs to generate per chunk (3 is a good balance)
const QA_PER_CHUNK = 3;

// Batch of chunks to process at once
const BATCH_SIZE = 3;

// Gemini quota
const GEMINI_RPM   = 60;
const GEMINI_RPD   = 1_500;
const CHUNK_DELAY  = Math.ceil(60_000 / GEMINI_RPM); // ms between embed calls

// OpenRouter — round-robin with 429 backoff
let _orKeyIndex = 0;
function nextOpenRouterKey(): string {
    const key = OPENROUTER_KEYS[_orKeyIndex % OPENROUTER_KEYS.length];
    _orKeyIndex++;
    return key;
}

const OR_DELAY = 2000; // ms between OpenRouter calls

async function callOpenRouter(prompt: string): Promise<string> {
    const MAX_RETRIES = OPENROUTER_KEYS.length * 2;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const key = nextOpenRouterKey();
        try {
            await sleep(OR_DELAY);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30_000); // 30s timeout
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': `Bearer ${key}`,
                    'HTTP-Referer':  'https://github.com/moroccan-edu-rag',
                    'X-Title':       'Moroccan Edu RAG',
                },
                body: JSON.stringify({
                    model:       OPENROUTER_MODEL,
                    messages:    [{ role: 'user', content: prompt }],
                    temperature: 0.3,
                }),
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (res.status === 429) {
                const retryAfter = parseInt(res.headers.get('retry-after') ?? '10', 10);
                const wait = Math.max(retryAfter, 10) * 1000;
                console.warn(`   ⏸️  OpenRouter 429 on key …${key.slice(-6)} — waiting ${wait / 1000}s then rotating…`);
                await sleep(wait);
                continue;
            }

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 200)}`);
            }

            const data = await res.json();
            return data.choices?.[0]?.message?.content ?? '';

        } catch (err: any) {
            if (attempt === MAX_RETRIES) throw err;
            const delay = 3000 * attempt;
            console.warn(`   ⚠️  OpenRouter attempt ${attempt} failed: ${formatError(err)} — retrying in ${delay / 1000}s…`);
            await sleep(delay);
        }
    }
    return '';
}

// Always-on loop
const RUN_AS_LOOP   = process.env.LOOP !== 'false';
const LOOP_INTERVAL = 2 * 60 * 1000;

const GRADE_FILTER = process.env.GRADE || null;

const GRADE_ORDER = [
    '2ème année Bac',
    '1ère année Bac',
    'Tronc Commun',
    '3ème année collège',
    '2ème année collège',
    '1ère année collège',
    '6ème année primaire',
    '5ème année primaire',
    '4ème année primaire',
    '3ème année primaire',
    '2ème année primaire',
    '1ère année primaire',
];

// ── Validation ────────────────────────────────────────────────────────────────
if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌  SUPABASE_URL and SUPABASE_KEY must be set in .env');
    process.exit(1);
}
if (GEMINI_KEYS.length === 0) {
    console.error('❌  GEMINI_API_KEY must be set in .env (comma-separated)');
    process.exit(1);
}
if (OPENROUTER_KEYS.length === 0) {
    console.error('❌  OPENROUTER_KEY must be set in .env (comma-separated)');
    process.exit(1);
}

// ── Clients ───────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Gemini key pool ───────────────────────────────────────────────────────────
function startOfDay(): number {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
}

const geminiPool = GEMINI_KEYS.map((key, i) => ({
    index:       i,
    client:      new GoogleGenAI({ apiKey: key }),
    minuteStart: Date.now(),
    minuteCount: 0,
    dayStart:    startOfDay(),
    dayCount:    0,
    exhausted:   false,
}));

let currentGeminiKey = 0;

function activeGeminiKey() { return geminiPool[currentGeminiKey]; }

function rotateGeminiKey(): boolean {
    const start = currentGeminiKey;
    do {
        currentGeminiKey = (currentGeminiKey + 1) % geminiPool.length;
        if (!geminiPool[currentGeminiKey].exhausted) {
            console.log(`🔑  Switched to Gemini key #${currentGeminiKey + 1}`);
            return true;
        }
    } while (currentGeminiKey !== start);
    return false;
}

function resetGeminiQuota(k: typeof geminiPool[0]): void {
    const now = Date.now();
    if (now - k.minuteStart >= 60_000) { k.minuteStart = now; k.minuteCount = 0; }
    if (now - k.dayStart >= 86_400_000) { k.dayStart = startOfDay(); k.dayCount = 0; k.exhausted = false; }
}

async function waitForGeminiQuota(): Promise<void> {
    const k = activeGeminiKey();
    resetGeminiQuota(k);

    if (k.dayCount >= GEMINI_RPD) {
        k.exhausted = true;
        console.warn(`\n🚫  Gemini key #${k.index + 1} daily quota hit.`);
        if (rotateGeminiKey()) return;

        const msLeft = k.dayStart + 86_400_000 - Date.now();
        const hh = Math.floor(msLeft / 3_600_000);
        const mm = Math.floor((msLeft % 3_600_000) / 60_000);
        console.warn(`😴  All Gemini keys exhausted. Sleeping ${hh}h ${mm}m until midnight…`);
        await sleep(msLeft + 2_000);
        geminiPool.forEach(gk => { gk.exhausted = false; gk.dayCount = 0; gk.dayStart = startOfDay(); });
        return;
    }

    if (k.minuteCount >= GEMINI_RPM) {
        const msLeft = Math.max(0, 60_000 - (Date.now() - k.minuteStart)) + 500;
        console.warn(`   ⏸️  Gemini RPM limit on key #${k.index + 1} — pausing ${(msLeft / 1000).toFixed(1)}s…`);
        await sleep(msLeft);
        resetGeminiQuota(k);
    }

    k.minuteCount++;
    k.dayCount++;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function formatError(err: any): string {
    if (!err) return 'unknown error';
    if (typeof err.message === 'string') return err.message;
    if (typeof err === 'string') return err;
    try { return JSON.stringify(err); } catch { return String(err); }
}

// ── Embed a question text ─────────────────────────────────────────────────────
async function embedQuestion(text: string): Promise<number[]> {
    const MAX_RETRIES = 3;
    let lastErr: any;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await waitForGeminiQuota();

            const result = await activeGeminiKey().client.models.embedContent({
                model:    EMBEDDING_MODEL,
                contents: text,
                config:   { taskType: 'RETRIEVAL_QUERY', outputDimensionality: OUTPUT_DIMS } as any,
            });

            const vector = result.embeddings?.[0]?.values;
            if (!vector || vector.length === 0) throw new Error('Gemini returned empty embedding');
            return Array.from(vector as number[]);

        } catch (err: any) {
            lastErr = err;
            const msg = formatError(err);
            const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
            const isRetryable = isRateLimit || msg.includes('500') || msg.includes('503') || msg.toLowerCase().includes('fetch failed');

            if (!isRetryable || attempt === MAX_RETRIES) throw err;

            if (isRateLimit) {
                activeGeminiKey().minuteCount = GEMINI_RPM;
                console.warn(`   ⏸️  Rate limited — rotating or waiting…`);
            } else {
                const delay = 2000 * Math.pow(2, attempt - 1);
                console.warn(`   ⚠️  Embed attempt ${attempt}/${MAX_RETRIES} — retrying in ${delay / 1000}s…`);
                await sleep(delay);
            }
        }
    }
    throw new Error(`All retries failed: ${formatError(lastErr)}`);
}

// ── Generate Q&A pairs via OpenRouter ─────────────────────────────────────────
interface QAPair {
    question: string;
    answer:   string;
}

async function generateQA(chunkContent: string, metadata: any): Promise<QAPair[]> {
    const grade   = metadata?.grade   ?? '';
    const subject = metadata?.subject ?? '';

    // Detect if content is Arabic (has Arabic Unicode chars)
    const hasArabic  = /[\u0600-\u06FF]/.test(chunkContent);
    const hasFrench  = /[àâçéèêëîïôùûüœæ]/i.test(chunkContent);
    const langHint   = hasArabic
        ? 'The content is in Arabic. Write ALL questions and answers in Arabic.'
        : hasFrench
            ? 'The content is in French. Write ALL questions and answers in French.'
            : 'Write questions and answers in the same language as the content (French or Arabic).';

    const prompt = `You are an expert educational content creator for Moroccan school curriculum.
Grade level: ${grade || 'unknown'}
Subject: ${subject || 'unknown'}
${langHint}

Read the following curriculum text and generate exactly ${QA_PER_CHUNK} educational question-answer pairs.

Rules:
- Questions should test understanding of key concepts in the text
- Answers must be directly supported by the text — do not add outside knowledge
- Questions should be what a student or teacher would actually ask
- Keep answers concise but complete (2-5 sentences)
- For math content: include the formula or step-by-step method in the answer
- Return ONLY valid JSON, no markdown, no extra text

Text:
"""
${chunkContent.substring(0, 2000)}
"""

Return this exact JSON format:
{
  "pairs": [
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." }
  ]
}`;

    try {
        const raw = await callOpenRouter(prompt);
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn(`   ⚠️  No JSON in OpenRouter response: ${raw.slice(0, 150)}`);
            return [];
        }
        const parsed = JSON.parse(jsonMatch[0]) as { pairs?: QAPair[] };
        const pairs  = parsed.pairs ?? [];
        return pairs.filter(p =>
            typeof p.question === 'string' && p.question.trim().length > 5 &&
            typeof p.answer   === 'string' && p.answer.trim().length > 5
        );
    } catch (err: any) {
        console.error(`   ❌  Q&A generation failed: ${formatError(err)}`);
        return [];
    }
}

// ── Ingest / embed activity guard ────────────────────────────────────────────
// Returns true if rag-ingest or embed-chunks is currently active.
// Q&A generation will wait until both are idle to avoid quota conflicts.
async function isIngestActive(): Promise<boolean> {
    // Chunks currently being embedded
    const { count: embeddingCount } = await supabase
        .from('rag_chunks')
        .select('*', { count: 'exact', head: true })
        .eq('embedding_status', 'processing');

    // Chunks inserted in the last 2 minutes (ingest still running)
    const recentCutoff = new Date(Date.now() - 2 * 60_000).toISOString();
    const { count: recentCount } = await supabase
        .from('rag_chunks')
        .select('*', { count: 'exact', head: true })
        .or('embedding_status.is.null,embedding_status.eq.pending')
        .gte('created_at', recentCutoff);

    return (embeddingCount ?? 0) > 0 || (recentCount ?? 0) > 0;
}

// ── Find next grade with pending Q&A work ─────────────────────────────────────
async function nextPriorityGrade(): Promise<string | null> {
    for (const gradeName of GRADE_ORDER) {
        const { data: g } = await supabase
            .from('grades').select('id').ilike('name', gradeName).maybeSingle();
        if (!g) continue;

        // Count chunks that are embedded but have no Q&A pairs yet
        const { count } = await supabase
            .from('rag_chunks')
            .select('*', { count: 'exact', head: true })
            .eq('embedding_status', 'done')
            .eq('grade_id', g.id)
            .eq('qa_generated', false);

        if (count && count > 0) return gradeName;
    }
    return null;
}

// ── Claim a batch of chunks needing Q&A ──────────────────────────────────────
async function claimBatch(): Promise<{ id: string; content: string; metadata: any; grade_id: string | null }[]> {
    let gradeId: string | null = null;
    const targetGrade = GRADE_FILTER ?? await nextPriorityGrade();

    if (targetGrade) {
        const { data: g } = await supabase
            .from('grades').select('id').ilike('name', targetGrade).maybeSingle();
        gradeId = g?.id ?? null;
        if (gradeId) console.log(`🎯  Processing grade: ${targetGrade}`);
    }

    let query = supabase
        .from('rag_chunks')
        .select('id, content, metadata, grade_id')
        .eq('embedding_status', 'done')
        .eq('qa_generated', false);

    if (gradeId) query = query.eq('grade_id', gradeId);

    const { data, error } = await query.limit(BATCH_SIZE);

    if (error) throw new Error(`Claim batch: ${error.message}`);
    return (data ?? []) as { id: string; content: string; metadata: any; grade_id: string | null }[];
}

// ── Count remaining ───────────────────────────────────────────────────────────
async function countPending(): Promise<number> {
    const { count, error } = await supabase
        .from('rag_chunks')
        .select('*', { count: 'exact', head: true })
        .eq('embedding_status', 'done')
        .eq('qa_generated', false);
    if (error) console.warn('⚠️  countPending error:', error.message);
    return count ?? 0;
}

// ── Save Q&A pairs to rag_questions ───────────────────────────────────────────
async function saveQAPairs(
    chunkId: string,
    gradeId: string | null,
    pairs: QAPair[],
    embeddings: number[][]
): Promise<number> {
    if (pairs.length === 0) return 0;

    const rows = pairs.map((p, i) => ({
        chunk_id:            chunkId,
        grade_id:            gradeId,
        question:            p.question.trim(),
        answer:              p.answer.trim(),
        question_embedding:  embeddings[i] ?? null,
        model_used:          OPENROUTER_MODEL,
        created_at:          new Date().toISOString(),
    }));

    const { error, data } = await supabase
        .from('rag_questions')
        .insert(rows)
        .select('id');

    if (error) {
        // Unique constraint — some pairs already exist, that's fine
        if (error.code === '23505') return 0;
        throw new Error(`Insert rag_questions: ${error.message}`);
    }

    return data?.length ?? 0;
}

// ── Mark chunk as Q&A done ────────────────────────────────────────────────────
async function markQADone(chunkId: string): Promise<void> {
    const { error } = await supabase
        .from('rag_chunks')
        .update({ qa_generated: true, qa_generated_at: new Date().toISOString() })
        .eq('id', chunkId);
    if (error) throw new Error(`markQADone: ${error.message}`);
}

async function markQAFailed(chunkId: string, reason: string): Promise<void> {
    // Don't block on failure — just log. The chunk stays qa_generated=false
    // so it will be retried on next sweep.
    console.error(`   ❌  [QA FAILED] chunk ${chunkId}: ${reason.slice(0, 200)}`);
}

// ── One full sweep ────────────────────────────────────────────────────────────
async function runSweep(): Promise<{ processed: number; failed: number; pairs: number }> {
    let totalProcessed = 0;
    let totalFailed    = 0;
    let totalPairs     = 0;
    let batchN         = 0;
    const sweepStart   = Date.now();
    const totalAtStart = await countPending();

    while (true) {
        let batch: { id: string; content: string; metadata: any; grade_id: string | null }[];
        try {
            batch = await claimBatch();
        } catch (err: any) {
            console.error('❌  Could not claim batch:', formatError(err));
            break;
        }

        if (batch.length === 0) break;
        batchN++;

        const pending = await countPending();
        const done    = totalAtStart - pending;
        console.log(`\n📦  Batch ${batchN} — ${batch.length} chunk(s)  |  ${done}/${totalAtStart} done`);

        for (const chunk of batch) {
            try {
                // 1. Generate Q&A pairs via OpenRouter
                process.stdout.write(`   🤖  Generating Q&A for chunk ${chunk.id.slice(0, 8)}…`);
                const pairs = await generateQA(chunk.content, chunk.metadata);

                if (pairs.length === 0) {
                    console.log(' ⚠️  0 pairs generated — skipping');
                    await markQADone(chunk.id); // don't retry forever
                    totalProcessed++;
                    continue;
                }

                process.stdout.write(` ${pairs.length} pairs\n`);

                // 2. Embed each question
                const embeddings: number[][] = [];
                for (let i = 0; i < pairs.length; i++) {
                    try {
                        const vec = await embedQuestion(pairs[i].question);
                        embeddings.push(vec);
                        process.stdout.write('✓');
                        await sleep(CHUNK_DELAY);
                    } catch (embErr: any) {
                        console.warn(`\n   ⚠️  Embed failed for Q${i + 1}: ${formatError(embErr)} — storing without embedding`);
                        embeddings.push([]); // null-like placeholder
                    }
                }
                process.stdout.write('\n');

                // 3. Save to rag_questions
                const saved = await saveQAPairs(chunk.id, chunk.grade_id, pairs, embeddings);
                totalPairs += saved;

                // 4. Mark chunk done
                await markQADone(chunk.id);
                totalProcessed++;
                console.log(`   ✅  Saved ${saved} Q&A pair(s) for chunk ${chunk.id.slice(0, 8)}`);

            } catch (err: any) {
                await markQAFailed(chunk.id, formatError(err));
                totalFailed++;
            }
        }
    }

    const elapsed = Math.round((Date.now() - sweepStart) / 1000);
    console.log(`\n⏱️  Sweep took ${elapsed}s`);
    return { processed: totalProcessed, failed: totalFailed, pairs: totalPairs };
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
    console.log('🚀  Q&A generation agent starting…');
    console.log(`   text model   : ${OPENROUTER_MODEL} (OpenRouter)`);
    console.log(`   embed model  : ${EMBEDDING_MODEL} (Gemini AI Studio)`);
    console.log(`   output dims  : ${OUTPUT_DIMS}`);
    console.log(`   openrouter   : ${OPENROUTER_KEYS.length} key(s) — round-robin`);
    console.log(`   gemini keys  : ${GEMINI_KEYS.length} key(s) — ${GEMINI_KEYS.length * GEMINI_RPD} RPD total`);
    console.log(`   Q&A per chunk: ${QA_PER_CHUNK}`);
    console.log(`   batch size   : ${BATCH_SIZE}`);
    console.log(`   grade filter : ${GRADE_FILTER ?? 'auto (highest → lowest)'}`);
    console.log(`   mode         : ${RUN_AS_LOOP ? 'always-on loop' : 'single sweep'}\n`);

    const pendingNow = await countPending();
    console.log(`   pending chunks needing Q&A: ${pendingNow}\n`);

    if (RUN_AS_LOOP) {
        let sweep = 0;
        while (true) {
            sweep++;
            console.log(`\n══════════════ QA Sweep #${sweep}  ${new Date().toISOString()} ══════════════`);

            // Wait while ingest or embed-chunks is active
            const active = await isIngestActive();
            if (active) {
                console.log('⏳  Ingest/embedding in progress — Q&A generation paused. Rechecking in 1 min…');
                await sleep(60_000);
                continue;
            }

            const pending = await countPending();
            console.log(`🔍  Pending: ${pending}`);

            if (pending === 0) {
                console.log('✅  All chunks have Q&A — sleeping until next check.');
            } else {
                const { processed, failed, pairs } = await runSweep();
                console.log(`\n📊  Sweep #${sweep} → processed: ${processed}  failed: ${failed}  pairs saved: ${pairs}`);
            }

            console.log(`⏳  Next check in ${LOOP_INTERVAL / 60_000}min  (${new Date(Date.now() + LOOP_INTERVAL).toLocaleTimeString()})…\n`);
            await sleep(LOOP_INTERVAL);
        }
    } else {
        const pending = await countPending();
        if (pending === 0) {
            console.log('✅  Nothing to do — all chunks already have Q&A pairs.');
            return;
        }

        const { processed, failed, pairs } = await runSweep();
        console.log(`\n\n✅  Done!`);
        console.log(`   Processed : ${processed} chunks`);
        console.log(`   Failed    : ${failed}`);
        console.log(`   Q&A pairs : ${pairs} saved`);
    }
}

main().catch(err => {
    console.error('💥  Unhandled error:', formatError(err));
    process.exit(1);
});
