/**
 * embed-chunks.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Atomic embedding agent for rag_chunks rows.
 *
 * Model: gemini-embedding-exp-03-07  (Gemini AI Studio experimental, 3072 dims
 *        downscaled to 768 via outputDimensionality)
 *
 * Quota guard (free-tier safe):
 *   • RPM_LIMIT    — max requests per minute (default 5 for experimental model)
 *   • RPD_LIMIT    — max requests per day   (default 1 500)
 *   • CHUNK_DELAY  — ms between individual embed calls
 *   • BATCH_DELAY  — ms between batches (on top of per-chunk delays)
 *   Counters reset automatically at the top of each minute / at midnight.
 *
 * State machine per row  (embedding_status column):
 *   NULL / 'pending'  →  needs embedding
 *   'processing'      →  claimed by this agent, in flight
 *   'done'            →  embedding saved – skip
 *   'skipped'         →  chunk too short – permanently skip
 *   'failed'          →  previous attempt errored – will retry (up to MAX_RETRIES)
 *
 * Run once:     npx tsx embed-chunks.ts
 * Run as loop:  LOOP=true npx tsx embed-chunks.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI }  from '@google/genai';
import 'dotenv/config';

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

// Multiple API keys — comma-separated in .env: GEMINI_API_KEY=key1,key2,key3
const API_KEYS = (process.env.GEMINI_API_KEY || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

// Gemini embedding — free on AI Studio, 3072 dims reduced to 1024 via outputDimensionality
const EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const OUTPUT_DIMS     = 1024;  // matches Supabase vector(1024)

// ── Rate limit — adjust RPM to control speed ─────────────────────────────────
// Gemini AI Studio free tier: 100 RPM, 1500 RPD
const RPM       = 60;    // requests per minute (safe margin under 100)
const RPD_LIMIT = 1_500; // daily cap — set Infinity if on paid plan

// Derived
const CHUNK_DELAY = Math.ceil(60_000 / RPM);

const BATCH_SIZE         = 5;
const MIN_CONTENT_LENGTH = 100;
const MAX_RETRIES        = 3;
const RETRY_BASE_MS      = 2000;
const BATCH_DELAY        = 500;
const STALE_MINUTES      = 10;

// Always run as a loop — sleeps when quota exhausted, resumes automatically
const RUN_AS_LOOP   = true;
const LOOP_INTERVAL = 2 * 60 * 1000; // recheck every 2 min when idle

// ── Grade processing order (highest → lowest) ─────────────────────────────────
// Set GRADE env var to process one grade at a time, or leave empty for all
// Example: GRADE="2ème année Bac" npx tsx embed-chunks.ts
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

// ── Quota helpers ─────────────────────────────────────────────────────────────
function startOfDay(): number {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
}

function resetKeyQuota(k: typeof keyPool[0]): void {
    const now = Date.now();
    if (now - k.minuteStart >= 60_000) { k.minuteStart = now; k.minuteCount = 0; }
    if (now - k.dayStart >= 86_400_000) { k.dayStart = startOfDay(); k.dayCount = 0; k.exhausted = false; }
}

async function waitForQuota(): Promise<void> {
    const k = activeKey();
    resetKeyQuota(k);

    // Daily quota hit on this key — try rotating
    if (k.dayCount >= RPD_LIMIT) {
        k.exhausted = true;
        console.warn(`\n🚫  Key #${k.index + 1} daily quota hit (${RPD_LIMIT} req).`);

        if (rotateKey()) return; // switched to a live key — no sleep needed

        // All keys exhausted — sleep until midnight
        const msLeft = k.dayStart + 86_400_000 - Date.now();
        const hh = Math.floor(msLeft / 3_600_000);
        const mm = Math.floor((msLeft % 3_600_000) / 60_000);
        console.warn(`😴  All ${keyPool.length} key(s) exhausted. Sleeping ${hh}h ${mm}m until midnight…`);
        await sleep(msLeft + 2_000);
        keyPool.forEach(k => { k.exhausted = false; k.dayCount = 0; k.dayStart = startOfDay(); });
        return;
    }

    // Per-minute cap — pause then continue with same key
    if (k.minuteCount >= RPM) {
        const msLeft = Math.max(0, 60_000 - (Date.now() - k.minuteStart)) + 500;
        console.warn(`   ⏸️  Key #${k.index + 1} RPM limit — pausing ${(msLeft / 1000).toFixed(1)}s…`);
        await sleep(msLeft);
        resetKeyQuota(k);
    }

    k.minuteCount++;
    k.dayCount++;
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌  SUPABASE_URL and SUPABASE_KEY must be set in .env');
    process.exit(1);
}
if (API_KEYS.length === 0) {
    console.error('❌  GEMINI_API_KEY must be set in .env (comma-separated for multiple keys)');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Key rotation ──────────────────────────────────────────────────────────────
// Each key gets its own quota tracker and genai client
const keyPool = API_KEYS.map((key, i) => ({
    index:       i,
    client:      new GoogleGenAI({ apiKey: key }),
    minuteStart: Date.now(),
    minuteCount: 0,
    dayStart:    startOfDay(),
    dayCount:    0,
    exhausted:   false,   // true when daily quota hit
}));

let currentKeyIndex = 0;

function activeKey() { return keyPool[currentKeyIndex]; }

function rotateKey(): boolean {
    const start = currentKeyIndex;
    do {
        currentKeyIndex = (currentKeyIndex + 1) % keyPool.length;
        if (!keyPool[currentKeyIndex].exhausted) {
            console.log(`🔑  Switched to API key #${currentKeyIndex + 1}`);
            return true;
        }
    } while (currentKeyIndex !== start);
    return false; // all keys exhausted
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function formatError(err: any): string {
    if (!err) return 'unknown error';
    if (typeof err.message === 'string') return err.message;
    if (typeof err === 'string') return err;
    try { return JSON.stringify(err); } catch { return String(err); }
}

// ── Gemini embed with retry ───────────────────────────────────────────────────
async function embedWithRetry(text: string, chunkId: string): Promise<number[]> {
    let lastErr: any;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await waitForQuota();

            const result = await activeKey().client.models.embedContent({
                model:    EMBEDDING_MODEL,
                contents: text,
                config:   { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: OUTPUT_DIMS } as any,
            });

            const vector = result.embeddings?.[0]?.values;
            if (!vector || vector.length === 0) {
                throw new Error('Gemini returned empty embedding');
            }

            if (attempt > 1) console.log(`   🔁  Chunk ${chunkId} succeeded on attempt ${attempt}`);

            return Array.from(vector as number[]);

        } catch (err: any) {
            lastErr = err;
            const msg = formatError(err);

            const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
            const isServerErr = msg.includes('500') || msg.includes('503');
            const isNetwork   = msg.toLowerCase().includes('fetch failed');
            const isRetryable = isRateLimit || isServerErr || isNetwork;

            if (!isRetryable) {
                console.error(`   ❌  Chunk ${chunkId} — non-retryable error: ${msg}`);
                throw err;
            }

            if (attempt < MAX_RETRIES) {
                if (isRateLimit) {
                    activeKey().minuteCount = RPM; // force quota pause or rotation
                    console.warn(`   ⏸️  Rate limited on key #${activeKey().index + 1} — rotating or waiting…`);
                } else {
                    const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
                    console.warn(`   ⚠️  Chunk ${chunkId} attempt ${attempt}/${MAX_RETRIES} — retrying in ${delay/1000}s…`);
                    await sleep(delay);
                }
            }
        }
    }

    throw new Error(`All ${MAX_RETRIES} attempts failed: ${formatError(lastErr)}`);
}

// ── Stale-claim recovery ──────────────────────────────────────────────────────
async function recoverStaleClaims(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
    const { data, error } = await supabase
        .from('rag_chunks')
        .update({ embedding_status: 'pending' })
        .eq('embedding_status', 'processing')
        .lt('embedding_claimed_at', cutoff)
        .select('id');

    if (error) {
        console.error('⚠️  Stale-claim recovery failed:', error.message);
    } else if (data && data.length > 0) {
        console.log(`♻️  Recovered ${data.length} stale claim(s) → 'pending'`);
    }
}

// ── Find next grade with pending chunks (highest → lowest) ───────────────────
async function nextPriorityGrade(): Promise<string | null> {
    for (const gradeName of GRADE_ORDER) {
        const { data: g } = await supabase
            .from('grades').select('id').ilike('name', gradeName).maybeSingle();
        if (!g) continue;

        const { count } = await supabase
            .from('rag_chunks')
            .select('*', { count: 'exact', head: true })
            .or('embedding_status.is.null,embedding_status.eq.pending,embedding_status.eq.failed')
            .is('embedding', null)
            .eq('grade_id', g.id);

        if (count && count > 0) return gradeName;
    }
    return null; // all grades done
}

// ── Claim a batch atomically ──────────────────────────────────────────────────
async function claimBatch(): Promise<{ id: string; content: string }[]> {
    // Build grade filter — either specific GRADE env var or next in priority order
    let gradeId: string | null = null;
    const targetGrade = GRADE_FILTER ?? await nextPriorityGrade();
    if (targetGrade) {
        const { data: g } = await supabase
            .from('grades').select('id').ilike('name', targetGrade).maybeSingle();
        gradeId = g?.id ?? null;
    }

    let query = supabase
        .from('rag_chunks')
        .select('id, content')
        .or('embedding_status.is.null,embedding_status.eq.pending,embedding_status.eq.failed')
        .is('embedding', null);

    if (gradeId) query = query.eq('grade_id', gradeId);

    const { data: candidates, error: selectErr } = await query.limit(BATCH_SIZE);

    if (selectErr) throw new Error(`Fetch candidates: ${selectErr.message}`);
    if (!candidates || candidates.length === 0) return [];

    const short  = candidates.filter(r => (r.content?.trim().length ?? 0) < MIN_CONTENT_LENGTH);
    const viable = candidates.filter(r => (r.content?.trim().length ?? 0) >= MIN_CONTENT_LENGTH);

    if (short.length > 0) {
        await supabase
            .from('rag_chunks')
            .update({ embedding_status: 'skipped' })
            .in('id', short.map(r => r.id as string));
        console.log(`   ⏭️  Skipped ${short.length} short chunk(s) (< ${MIN_CONTENT_LENGTH} chars)`);
    }

    if (viable.length === 0) return [];

    const ids = viable.map(r => r.id as string);
    const { error: claimErr } = await supabase
        .from('rag_chunks')
        .update({
            embedding_status:     'processing',
            embedding_claimed_at: new Date().toISOString()
        })
        .in('id', ids);

    if (claimErr) throw new Error(`Claim batch: ${claimErr.message}`);
    return viable as { id: string; content: string }[];
}

// ── Save / fail helpers ───────────────────────────────────────────────────────
async function saveEmbedding(id: string, vector: number[]): Promise<void> {
    const { error } = await supabase
        .from('rag_chunks')
        .update({
            embedding:             vector,
            embedding_status:      'done',
            embedding_model:       EMBEDDING_MODEL,
            is_processed:          true,
            processed_at:          new Date().toISOString(),
            last_embedding_error:  null,
        })
        .eq('id', id);
    if (error) throw new Error(`Save failed for ${id}: ${error.message}`);
}

async function markFailed(id: string, reason: string): Promise<void> {
    const truncated = reason.slice(0, 400);

    await supabase
        .from('rag_chunks')
        .update({
            embedding_status:     'failed',
            last_embedding_error: truncated,
            error_message:        truncated,
        })
        .eq('id', id);
    console.error(`   ❌  [FAILED] chunk ${id}: ${truncated}`);
}

// ── Count pending ─────────────────────────────────────────────────────────────
async function countPending(): Promise<number> {
    const { count, error } = await supabase
        .from('rag_chunks')
        .select('*', { count: 'exact', head: true })
        .or('embedding_status.is.null,embedding_status.eq.pending,embedding_status.eq.failed')
        .is('embedding', null);
    if (error) console.warn('⚠️  countPending error:', error.message);
    return count ?? 0;
}

function formatEta(ms: number): string {
    if (!isFinite(ms) || ms <= 0) return '?';
    const s = Math.ceil(ms / 1000);
    if (s < 60)  return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// ── One full sweep ────────────────────────────────────────────────────────────
async function runSweep(): Promise<{ updated: number; failed: number }> {
    let totalUpdated = 0;
    let totalFailed  = 0;
    let batchN       = 0;
    const sweepStart = Date.now();
    const totalAtStart = await countPending();

    while (true) {
        let batch: { id: string; content: string }[];
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
        const pct     = totalAtStart > 0 ? Math.round((done / totalAtStart) * 100) : 0;
        const elapsed = Date.now() - sweepStart;
        const rate    = done > 0 ? elapsed / done : 0;
        const eta     = rate > 0 ? formatEta(rate * pending) : '?';

        console.log(`\n📦  Batch ${batchN} — ${batch.length} chunk(s)  |  ${done}/${totalAtStart} done (${pct}%)  |  ETA ${eta}`);

        for (let i = 0; i < batch.length; i++) {
            const { id, content } = batch[i];
            const isLast = i === batch.length - 1;

            try {
                const vector = await embedWithRetry(content, id);
                await saveEmbedding(id, vector);
                totalUpdated++;
                process.stdout.write('✓');
            } catch (err: any) {
                await markFailed(id, formatError(err));
                totalFailed++;
                process.stdout.write('✗');
            }

            // Skip delay after the very last chunk of this batch
            if (!isLast) await sleep(CHUNK_DELAY);
        }

        process.stdout.write('\n');

        // Extra pause between batches only when more work remains
        if (batch.length === BATCH_SIZE) {
            console.log(`   ⏳  Batch pause ${BATCH_DELAY / 1000}s…`);
            await sleep(BATCH_DELAY);
        }
    }

    const totalSecs = Math.round((Date.now() - sweepStart) / 1000);
    console.log(`\n⏱️  Sweep took ${formatEta(totalSecs * 1000)}`);
    return { updated: totalUpdated, failed: totalFailed };
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
    console.log('🚀  Embedding agent starting…');
    console.log(`   provider     : Gemini AI Studio`);
    console.log(`   model        : ${EMBEDDING_MODEL}`);
    console.log(`   output dims  : ${OUTPUT_DIMS}`);
    console.log(`   api keys     : ${API_KEYS.length} key(s) — total quota ${API_KEYS.length * RPD_LIMIT} RPD`);
    console.log(`   rate limit   : ${RPM} RPM per key`);
    console.log(`   batch size   : ${BATCH_SIZE}`);
    console.log(`   grade filter : ${GRADE_FILTER ?? 'auto (highest → lowest)'}`);
    console.log(`   mode         : always-on loop (auto-sleeps on quota, resumes at midnight)`);

    const pendingNow = await countPending();
    const estimatedMs = pendingNow * (CHUNK_DELAY + 1000); // rough: delay + ~1s per embed
    console.log(`   pending      : ${pendingNow} chunk(s)  |  est. time: ${formatEta(estimatedMs)}\n`);

    if (RUN_AS_LOOP) {
        let sweep = 0;
        while (true) {
            sweep++;
            console.log(`\n══════════════ Sweep #${sweep}  ${new Date().toISOString()} ══════════════`);
            await recoverStaleClaims();
            const pending = await countPending();
            console.log(`🔍  Pending: ${pending}`);

            if (pending === 0) {
                console.log('✅  Nothing to do — sleeping until next sweep.');
            } else {
                const { updated, failed } = await runSweep();
                console.log(`\n📊  Sweep #${sweep} → embedded: ${updated}  failed: ${failed}`);
                if (failed > 0) console.log(`   ℹ️  Re-run to retry ${failed} failed chunk(s).`);
            }

            console.log(`⏳  Next sweep in ${LOOP_INTERVAL / 60_000}min  (${new Date(Date.now() + LOOP_INTERVAL).toLocaleTimeString()})…\n`);
            await sleep(LOOP_INTERVAL);
        }
    } else {
        await recoverStaleClaims();

        const total = await countPending();
        console.log(`🔍  Found ${total} chunk(s) needing embeddings\n`);

        if (total === 0) {
            console.log('✅  Nothing to do — all chunks already have embeddings.');
            return;
        }

        const { updated, failed } = await runSweep();
        console.log(`\n\n✅  Done!`);
        console.log(`   Embedded : ${updated}`);
        console.log(`   Failed   : ${failed}`);
        if (failed > 0) console.log(`   ℹ️  Re-run to retry the ${failed} failed chunk(s).`);
    }
}

main().catch(err => {
    console.error('💥  Unhandled error:', formatError(err));
    process.exit(1);
});
