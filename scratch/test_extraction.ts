import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

// Using legacy build for Node.js to avoid DOMMatrix error
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const testPdfPath = path.resolve('auto_ingest_pdfs/2017/1ère année Bac/1ère année Bac_2017_Lesson_1bac.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.error.pdf');

async function testExtraction() {
    console.log('Testing extraction on:', path.basename(testPdfPath));
    const dataBuffer = fs.readFileSync(testPdfPath);
    
    // 1. pdf-parse
    try {
        const data = await pdfParse(dataBuffer);
        console.log('\n--- pdf-parse output (first 300 chars) ---');
        console.log(data.text.substring(0, 300));
    } catch (e) {
        console.error('pdf-parse failed:', e.message);
    }
    
    // 2. pdfjs-dist
    try {
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(dataBuffer) }).promise;
        let fullText = '';
        const numPages = Math.min(doc.numPages, 3); // Just check first 3 pages
        for (let i = 1; i <= numPages; i++) {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map((item: any) => item.str).join(' ');
            fullText += pageText + '\n\n';
        }
        console.log('\n--- pdfjs-dist output (first 300 chars) ---');
        console.log(fullText.substring(0, 300));
    } catch (e) {
        console.error('pdfjs-dist failed:', e.message);
    }
}

testExtraction();
