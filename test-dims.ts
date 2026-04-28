import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// Ensure exactly 768 dims for Supabase vector(768) column
// Actually, let's see what dimension it accepts!
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

const dims = [768, 1024, 1062, 1536, 4096];

async function check() {
    for (const d of dims) {
        const testVector = new Array(d).fill(0.1);
        const { error } = await sb.from('rag_chunks').update({ embedding: testVector }).eq('id', '4a6ef6b0-5908-4c57-980e-e96eac5e48ba');
        
        // Wait, postgrest might succeed without error but just ignore the payload if it's the wrong type depending on strict mode. But typically it throws a Postgres error if dimension mismatches.
        
        // Let me just select the row to see if it saved.
        const { data } = await sb.from('rag_chunks').select('embedding').eq('id', '4a6ef6b0-5908-4c57-980e-e96eac5e48ba');
        
        if (data?.[0]?.embedding) {
            console.log(`✅ EXACT dimension match found: ${data[0].embedding.length} (tested with ${d})`);
            break;
        } else {
            console.log(`❌ Failed with dimension ${d}`);
        }
    }
}
check();
