import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const targetDir = 'auto_ingest_pdfs';

function getPdfs(dir: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getPdfs(fullPath));
        } else {
            const lower = file.toLowerCase();
            if (lower.endsWith('.pdf') && !lower.endsWith('.done.pdf') && !lower.endsWith('.error.pdf')) {
                results.push(fullPath);
            }
        }
    }
    return results;
}

async function main() {
    const files = getPdfs(targetDir);
    console.log(`Found ${files.length} PDFs to ingest.`);
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`\n[${i + 1}/${files.length}] Starting: ${file}`);
        try {
            await new Promise<void>((resolve, reject) => {
                const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
                const child = spawn(npx, ['tsx', 'ingest-worker.ts', file], {
                    stdio: 'inherit',
                    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' }
                });
                
                child.on('exit', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Worker exited with code ${code}`));
                });
                
                child.on('error', reject);
            });
        } catch (err: any) {
            console.error(`Error processing ${file}:`, err.message);
        }
    }
    
    console.log('\nBatch ingestion complete!');
}

main().catch(console.error);
