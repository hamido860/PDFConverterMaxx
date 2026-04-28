/**
 * embed-local.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Atomic embedding agent for rag_chunks rows using LOCAL OLLAMA.
 *
 * Configured for Ollama endpoint instead of Google Gemini.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL   = process.env.SUPABASE_URL   || '';
const SUPABASE_KEY   = process.env.SUPABASE_KEY   || '';
const OLLAMA_URL     = 'http://localhost:11434/api/embed'; // Ollama embed API

const EMBEDDING_MODEL    = 'qwen3-embedding'; 
const BATCH_SIZE         = 5;    // smaller batch for local inference
const RATE_LIMIT_MS      = 100;  // ms pause between batches (local is fast, but let's give it a breather)
const STALE_MINUTES      = 10;   // reclaim 'processing' rows older than this
const LOOP_INTERVAL      = 30_000; // ms between sweeps when LOOP=true
const MIN_CONTENT_LENGTH = 100;  // skip chunks shorter than this
const MAX_RETRIES        = 2;    // per-chunk retry attempts
const RETRY_BASE_MS      = 2000; // base delay for exponential backoff

const RUN_AS_LOOP = process.env.LOOP === 'true';
// ─────────────────────────────────────────────────────────────────────────────

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌  SUPABASE_URL and SUPABASE_KEY must be set in .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function formatError(err: any): string {
    if (!err) return 'unknown error';
    if (typeof err.message === 'string') return err.message;
    if (typeof err === 'string') return err;
    try { return JSON.stringify(err); } catch { return String(err); }
}

// ── Embed one text using Ollama ───────────────────────────────────────────────
async function embedWithRetry(text: string, chunkId: string): Promise<number[]> {
    let lastErr: any;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const resp = await fetch(OLLAMA_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: EMBEDDING_MODEL,
                    input: text
                })
            });

            if (!resp.ok) {
                throw new Error(`Ollama HTTP Error: ${resp.status} ${resp.statusText}`);
            }

            const result = await resp.json();
            const emb = result.embeddings?.[0];

            if (!emb || emb.length === 0) {
                throw new Error('Ollama returned empty embedding values');
            }

            if (attempt > 1) {
                console.log(`   🔁  Chunk ${chunkId} succeeded on attempt ${attempt}`);
            }
            
            // Ensure exactly 1024 dims for Supabase vector(1024) column
            const vector = Array.from(emb as number[]);
            return vector.length > 1024 ? vector.slice(0, 1024) : vector;

        } catch (err: any) {
            lastErr = err;
            const msg = formatError(err);
            
            // We assume backend/network errors from Ollama are retryable.
            if (attempt < MAX_RETRIES) {
                const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
                console.warn(`   ⚠️  Chunk ${chunkId} attempt ${attempt}/${MAX_RETRIES} failed (${msg}) — retrying in ${delay}ms…`);
                await sleep(delay);
            }
        }
    }

    throw new Error(`All ${MAX_RETRIES} attempts failed: ${formatError(lastErr)}`);
}

// ── Step 0: Stale-claim recovery ──────────────────────────────────────────────
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

// ── Step 1: Claim a batch atomically ──────────────────────────────────────────
async function claimBatch(): Promise<{ id: string; content: string }[]> {
    const { data: candidates, error: selectErr } = await supabase
        .from('rag_chunks')
        .select('id, content')
        .or('embedding_status.is.null,embedding_status.eq.pending,embedding_status.eq.failed')
        .is('embedding', null)
        .limit(BATCH_SIZE);

    if (selectErr) throw new Error(`Fetch candidates: ${selectErr.message}`);
    if (!candidates || candidates.length === 0) return [];

    // Skip chunks that are too short
    const short  = candidates.filter(r => (r.content?.trim().length ?? 0) < MIN_CONTENT_LENGTH);
    const viable = candidates.filter(r => (r.content?.trim().length ?? 0) >= MIN_CONTENT_LENGTH);

    if (short.length > 0) {
        const shortIds = short.map(r => r.id as string);
        await supabase
            .from('rag_chunks')
            .update({ embedding_status: 'skipped' })
            .in('id', shortIds);
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

// ── Step 3: Save embedding ─────────────────────────────────────────────────────
async function saveEmbedding(id: string, vector: number[]): Promise<void> {
    const { error } = await supabase
        .from('rag_chunks')
        .update({
            embedding:        vector,
            embedding_status: 'done'
        })
        .eq('id', id);

    if (error) throw new Error(`Save failed for ${id}: ${error.message}`);
}

// ── Step 4: Mark a chunk permanently failed ────────────────────────────────────
async function markFailed(id: string, reason: string): Promise<void> {
    const truncated = reason.slice(0, 400); // keep metadata sane
    await supabase
        .from('rag_chunks')
        .update({
            embedding_status: 'failed',
            metadata: { embed_error: truncated, failed_at: new Date().toISOString() }
        })
        .eq('id', id);

    console.error(`   ❌  [FAILED] chunk ${id}: ${truncated}`);
}

async function countPending(): Promise<number> {
    const { data } = await supabase
        .from('rag_chunks')
        .select('id')
        .or('embedding_status.is.null,embedding_status.eq.pending,embedding_status.eq.failed')
        .is('embedding', null);
    return (data as any[])?.length ?? 0;
}

// ── One full sweep ────────────────────────────────────────────────────────────
async function runSweep(): Promise<{ updated: number; failed: number; skipped: number }> {
    let totalUpdated = 0;
    let totalFailed  = 0;
    let totalSkipped = 0; // Not explicitly tracked here
    let batchN       = 0;

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
        console.log(`\n📦  Batch ${batchN} — ${batch.length} chunk(s) | ~${pending} still pending`);

        for (const { id, content } of batch) {
            try {
                const vector = await embedWithRetry(content, id);
                await saveEmbedding(id, vector);
                totalUpdated++;
                process.stdout.write('✓');
            } catch (err: any) {
                await markFailed(id, formatError(err));
                totalFailed++;
            }
        }
        process.stdout.write('\n');
        await sleep(RATE_LIMIT_MS);
    }

    return { updated: totalUpdated, failed: totalFailed, skipped: totalSkipped };
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
    console.log('🚀  Ollama Local Embedding agent starting…');
    console.log(`   model        : ${EMBEDDING_MODEL}`);
    console.log(`   batch size   : ${BATCH_SIZE}`);
    console.log(`   min length   : ${MIN_CONTENT_LENGTH} chars`);
    console.log(`   mode         : ${RUN_AS_LOOP ? `loop (every ${LOOP_INTERVAL / 1000}s)` : 'single run'}\n`);

    if (RUN_AS_LOOP) {
        let sweep = 0;
        while (true) {
            sweep++;
            console.log(`\n══════════════ Sweep #${sweep}  ${new Date().toISOString()} ══════════════`);
            await recoverStaleClaims();
            console.log(`🔍  Pending: ${await countPending()}`);
            const { updated, failed } = await runSweep();
            console.log(`\n📊  Sweep #${sweep} → updated: ${updated}  failed: ${failed}`);
            console.log(`⏳  Sleeping ${LOOP_INTERVAL / 1000}s until next sweep…`);
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
    }
}

main().catch(err => {
    console.error('💥  Unhandled error:', formatError(err));
    process.exit(1);
});
