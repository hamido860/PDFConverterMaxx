import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

const { data, error } = await sb
  .from('rag_chunks')
  .select('id, embedding_status, embedding')
  .limit(5);

if (error) { console.error('❌', error.message); process.exit(1); }

console.log('📊 Sample of rag_chunks rows:\n');
for (const row of data ?? []) {
  const embLen = Array.isArray(row.embedding) ? row.embedding.length : (row.embedding ? 'non-null' : 'NULL');
  console.log(`  id: ${row.id}`);
  console.log(`  status: ${row.embedding_status ?? 'null'}`);
  console.log(`  embedding: ${embLen} dimensions`);
  console.log('');
}

// Count by status
let counts: any = null;
try {
  const result = await sb.rpc('exec_sql' as any, {
    query: `SELECT embedding_status, COUNT(*) as total, COUNT(embedding) as has_embedding FROM rag_chunks GROUP BY embedding_status ORDER BY embedding_status`
  });
  counts = result.data;
} catch { counts = null; }

// Fallback: just fetch stats manually
const { data: all } = await sb.from('rag_chunks').select('embedding_status, embedding');
const stats: Record<string, {total: number, embedded: number}> = {};
for (const row of all ?? []) {
  const s = row.embedding_status ?? 'null';
  if (!stats[s]) stats[s] = { total: 0, embedded: 0 };
  stats[s].total++;
  if (row.embedding !== null) stats[s].embedded++;
}

console.log('📈 Status breakdown:');
for (const [status, { total, embedded }] of Object.entries(stats)) {
  console.log(`  ${status}: ${total} rows | ${embedded} have embeddings`);
}
