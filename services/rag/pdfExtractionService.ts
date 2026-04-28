import fs from 'fs';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ExtractedPage, ExtractionResult } from './types';

const LOW_TEXT_THRESHOLD = 40;

export const pdfExtractionService = {
  async extract(filePath: string): Promise<ExtractionResult> {
    const fileName = path.basename(filePath);
    const buffer = fs.readFileSync(filePath);
    const document = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const pages: ExtractedPage[] = [];
    let lowTextPages = 0;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item: any) => item.str ?? '').join(' ').replace(/\s+/g, ' ').trim();
      const extractedTextLength = text.length;
      const lowText = extractedTextLength < LOW_TEXT_THRESHOLD;

      if (lowText) {
        lowTextPages++;
      }

      pages.push({
        pageNumber,
        text,
        extractedTextLength,
        lowText,
        ocrDetected: false,
      });
    }

    let extractionMode: ExtractionResult['extractionMode'] = 'text';
    if (lowTextPages === document.numPages) {
      extractionMode = 'scanned';
    } else if (lowTextPages > 0) {
      extractionMode = 'hybrid';
    }

    return {
      fileName,
      pages,
      totalPages: document.numPages,
      extractionMode,
    };
  },
};
