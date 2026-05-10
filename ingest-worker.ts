import fs from 'fs';
import path from 'path';
import { ingest } from './rag-ingest';
import 'dotenv/config';

const absolutePath = process.argv[2];

if (!absolutePath) {
  console.error('[ingest-worker] No file path provided');
  process.exit(1);
}

if (!fs.existsSync(absolutePath)) {
  console.error(`[ingest-worker] File not found: ${absolutePath}`);
  process.exit(1);
}

const file = path.basename(absolutePath);
console.log(`[ingest-worker] Processing: ${file}`);

try {
  const result = await ingest(absolutePath);

  if (result.status === 'duplicate') {
    const donePath = absolutePath.replace(/\.pdf$/i, '.done.pdf');
    try {
      fs.renameSync(absolutePath, donePath);
      console.log(`[ingest-worker] Marked duplicate as done: ${file}`);
    } catch {}
  } else {
    console.log(`[ingest-worker] Done (${result.status}): ${file}`);
  }
  process.exit(0);
} catch (err: any) {
  console.error(`[ingest-worker] Fatal error processing ${file}:`, err.message);
  process.exit(1);
}
