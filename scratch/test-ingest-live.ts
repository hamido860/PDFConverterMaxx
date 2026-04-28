/**
 * test-ingest-live.ts
 * Runs a real ingest on the first PDF found and prints every DB error verbatim.
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

function md5(text: string) {
  return crypto.createHash('md5').update(text).digest('hex');
}

async function main() {
  console.log('🔬 Testing minimal rag_chunks INSERT...\n');

  const testContent = 'Test chunk content for diagnostic purposes. This is a sample text to verify the insert works correctly with all required columns.';
  const hash = md5(testContent);

  // First clean up any previous test row
  await supabase.from('rag_chunks').delete().eq('content_hash', hash);

  const { data, error } = await supabase.from('rag_chunks').insert({
    content:          testContent,
    content_hash:     hash,
    source_type:      'lesson_block',
    source_id:        null,
    grade_id:         null,
    cycle_id:         null,
    curriculum_id:    null,
    chunk_index:      0,
    chunk_size:       testContent.length,
    embedding_status: 'pending',
    is_processed:     false,
    metadata: {
      filename:      'test-diagnostic.pdf',
      autoClassified: true,
      timestamp:     new Date().toISOString(),
    },
  }).select();

  if (error) {
    console.error('❌ INSERT FAILED:');
    console.error('   code   :', error.code);
    console.error('   message:', error.message);
    console.error('   details:', error.details);
    console.error('   hint   :', error.hint);
    console.error('\nFull error object:', JSON.stringify(error, null, 2));
  } else {
    console.log('✅ INSERT SUCCEEDED! Row ID:', data?.[0]?.id);
    console.log('   Columns written:', Object.keys(data?.[0] ?? {}).join(', '));

    // Clean up test row
    await supabase.from('rag_chunks').delete().eq('content_hash', hash);
    console.log('🧹 Test row cleaned up.');
  }

  // Now check what columns are actually NOT NULL
  console.log('\n📋 Checking which columns are NOT NULL in real schema...');
  const { data: sample } = await supabase
    .from('rag_chunks')
    .select('*')
    .limit(1);

  if (sample && sample.length > 0) {
    console.log('Real columns:', Object.keys(sample[0]).join(', '));
    const nullCols = Object.entries(sample[0])
      .filter(([, v]) => v === null)
      .map(([k]) => k);
    console.log('Columns with null values in sample row:', nullCols.join(', ') || 'none');
  } else {
    console.log('Table is empty — cannot detect nullability from data.');
  }
}

main().catch(console.error);
