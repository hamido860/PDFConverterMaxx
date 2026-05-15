import { ingest } from '../rag-ingest.ts';
import path from 'path';

const PDF = path.resolve('auto_ingest_pdfs/scraped_pdfs_1776575172370/2022/UnknownGrade/UnknownGrade_2022_Lesson_expression-ecrite-sur-la-pollution.pdf');

console.log('=== Live Ingest Test ===');
console.log('File:', PDF);
console.time('total');

const result = await ingest(PDF);

console.timeEnd('total');
console.log('\n=== Result ===');
console.log(JSON.stringify(result, null, 2));
