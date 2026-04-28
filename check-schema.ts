/**
 * check-schema.ts
 * Checks what columns exist on rag_chunks and applies migration if needed.
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

async function main() {
  console.log('🔍 Checking rag_chunks columns...\n');

  // Try to read a single row to see what columns exist
  const { data, error } = await supabase
    .from('rag_chunks')
    .select('*')
    .limit(1);

  if (error) {
    console.error('❌ Error reading rag_chunks:', error.message);
    return;
  }

  if (data && data.length > 0) {
    console.log('✅ rag_chunks columns found:');
    Object.keys(data[0]).forEach(col => console.log(`   - ${col}`));
  } else {
    console.log('⚠️  rag_chunks table is empty — cannot detect columns from data.');
  }

  // Check specifically for embedding_claimed_at
  const row = data?.[0] ?? {};
  const hasStatus    = 'embedding_status'    in row;
  const hasClaimed   = 'embedding_claimed_at' in row;
  const hasHash      = 'content_hash'         in row;

  console.log(`\n📋 Migration status:`);
  console.log(`   embedding_status:     ${hasStatus    ? '✅ exists' : '❌ MISSING'}`);
  console.log(`   embedding_claimed_at: ${hasClaimed   ? '✅ exists' : '❌ MISSING'}`);
  console.log(`   content_hash:         ${hasHash      ? '✅ exists' : '❌ MISSING'}`);

  if (!hasStatus || !hasClaimed || !hasHash) {
    console.log('\n⚠️  Migration not fully applied. Please run the SQL below in Supabase SQL Editor:');
    console.log(`
ALTER TABLE public.rag_chunks
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

ALTER TABLE public.rag_chunks
  ADD COLUMN IF NOT EXISTS embedding_status TEXT
    DEFAULT 'pending'
    CHECK (embedding_status IN ('pending', 'processing', 'done', 'failed'));

ALTER TABLE public.rag_chunks
  ADD COLUMN IF NOT EXISTS embedding_claimed_at TIMESTAMPTZ;

UPDATE public.rag_chunks
  SET embedding_status = CASE
    WHEN embedding IS NOT NULL THEN 'done'
    ELSE 'pending'
  END
  WHERE embedding_status IS NULL;

NOTIFY pgrst, 'reload schema';
    `);
  } else {
    console.log('\n🎉 All migration columns present! Ready to run embed-chunks.ts');
  }
}

main().catch(console.error);
