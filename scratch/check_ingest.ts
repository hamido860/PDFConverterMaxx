
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_KEY || ''
);

async function checkRecentIngest() {
    console.log('Checking recent rag_chunks...');
    const { data, error } = await supabase
        .from('rag_chunks')
        .select('created_at, metadata->filename, embedding_status')
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    if (!data || data.length === 0) {
        console.log('No chunks found in rag_chunks.');
    } else {
        console.table(data);
    }
}

checkRecentIngest();
