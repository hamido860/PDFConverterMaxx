import type { ChunkDraft, DocumentClassification, ExtractedPage } from './types';
import { normalizeChunkContent } from './utils';

const MAX_CHUNK_LENGTH = 2200;

function detectSegmentType(text: string): string {
  const normalized = text.toLowerCase();
  if (normalized.length < 80) return 'title';
  if (/^(definition|définition|تعريف)\b/i.test(text)) return 'definition';
  if (/^(example|exemple|مثال)\b/i.test(text)) return 'example';
  if (/^(exercise|exercice|تمرين)\b/i.test(text)) return 'exercise';
  return 'paragraph';
}

function detectTitle(text: string, fallback: string | null): string | null {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  if (
    firstLine.length >= 8 &&
    firstLine.length <= 120 &&
    /[a-zA-Z؀-ۿ]/.test(firstLine) &&
    !/^[\d\s\W]+$/.test(firstLine)
  ) {
    return firstLine;
  }
  return fallback;
}

export const chunkGeneratorService = {
  generate(pages: ExtractedPage[], classification: DocumentClassification): ChunkDraft[] {
    const chunks: ChunkDraft[] = [];
    let chunkIndex = 0;
    let carry = '';
    let carryStartPage = 1;
    let carryOcrDetected = false;

    const flushCarry = (pageEnd: number) => {
      const cleaned = normalizeChunkContent(carry);
      if (!cleaned) return;

      chunks.push({
        chunkIndex: chunkIndex++,
        content: cleaned,
        originalContent: cleaned,
        pageStart: carryStartPage,
        pageEnd,
        title: detectTitle(cleaned, classification.title),
        language: classification.language,
        metadata: {
          segmentType: detectSegmentType(cleaned),
          source: 'pdf_extraction',
        },
        ocrDetected: carryOcrDetected,
      });

      carry = '';
      carryOcrDetected = false;
    };

    for (const page of pages) {
      const blocks = page.text
        .split(/(?:(?:\r?\n){2,})|(?<=\.)\s{2,}|(?<=\u061F)\s+/)
        .map(block => normalizeChunkContent(block))
        .filter(Boolean);

      if (blocks.length === 0) {
        const placeholder = `[Page ${page.pageNumber}]`;
        if (!carry) {
          carryStartPage = page.pageNumber;
        }
        carry = carry ? `${carry}\n\n${placeholder}` : placeholder;
        carryOcrDetected = carryOcrDetected || page.ocrDetected;
        continue;
      }

      for (const block of blocks) {
        if (!carry) {
          carryStartPage = page.pageNumber;
        }

        const candidate = carry ? `${carry}\n\n${block}` : block;
        if (candidate.length > MAX_CHUNK_LENGTH && carry) {
          flushCarry(page.pageNumber);
          carryStartPage = page.pageNumber;
          carry = block;
          carryOcrDetected = page.ocrDetected;
        } else {
          carry = candidate;
          carryOcrDetected = carryOcrDetected || page.ocrDetected;
        }
      }

      if (carry.length >= 1200 || page.lowText) {
        flushCarry(page.pageNumber);
      }
    }

    if (carry) {
      flushCarry(pages[pages.length - 1]?.pageNumber ?? 1);
    }

    return chunks.map(chunk => ({
      ...chunk,
      metadata: {
        ...chunk.metadata,
        documentTitle: classification.title,
      },
    }));
  },
};
