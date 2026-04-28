import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

// Reset stuck 'processing' rows → 'pending'
const { data, error } = await sb
  .from('rag_chunks')
  .update({ embedding_status: 'pending' })
  .in('embedding_status', ['processing', 'failed'])
  .select('id');

console.log(`♻️  Reset ${data?.length ?? 0} stuck rows → 'pending'. Error: ${error?.message ?? 'none'}`);
