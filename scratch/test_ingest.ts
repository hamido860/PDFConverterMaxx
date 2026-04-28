import { ingest } from '../rag-ingest.ts';
import path from 'path';

async function test() {
    const file = path.resolve('auto_ingest_pdfs/2017/1ère année Bac/1ère année Bac_2017_Lesson_1bac.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.pdf');
    console.log(`Testing ingest on: ${file}`);
    const result = await ingest(file);
    console.log('Result:', result);
}

test();
