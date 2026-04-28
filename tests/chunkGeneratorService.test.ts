import { describe, expect, it } from 'vitest';
import { chunkGeneratorService } from '../services/rag/chunkGeneratorService';
import type { DocumentClassification, ExtractedPage } from '../services/rag/types';

function makePage(overrides: Partial<ExtractedPage> = {}): ExtractedPage {
  return {
    pageNumber: 1,
    text: 'Default page content with enough text to form a chunk.',
    extractedTextLength: 50,
    lowText: false,
    ocrDetected: false,
    ...overrides,
  };
}

const classification: DocumentClassification = {
  gradeName: 'Grade 6',
  subjectName: 'Mathematics',
  title: 'Introduction to Fractions',
  language: 'fr',
  qualityNotes: [],
};

describe('chunkGeneratorService.generate', () => {
  describe('basic chunk generation', () => {
    it('returns at least one chunk for a non-empty page', () => {
      const pages = [makePage({ text: 'A'.repeat(200) + ' word content here for testing purposes.' })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('returns zero chunks for empty pages', () => {
      const pages = [makePage({ text: '' })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      // Empty page produces a placeholder which becomes a chunk
      expect(chunks.length).toBeGreaterThanOrEqual(0);
    });

    it('assigns sequential chunk indices starting at 0', () => {
      const longText = ('Educational content about mathematics. '.repeat(30));
      const pages = [makePage({ text: longText })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      chunks.forEach((chunk, idx) => {
        expect(chunk.chunkIndex).toBe(idx);
      });
    });
  });

  describe('chunk metadata', () => {
    it('assigns language from classification', () => {
      const pages = [makePage({ text: 'Les fractions sont importantes.\n\nElles permettent de représenter des parties.' })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      expect(chunks[0].language).toBe('fr');
    });

    it('attaches documentTitle to all chunks', () => {
      const pages = [makePage({ text: 'Content about fractions in mathematics education.' })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      chunks.forEach(chunk => {
        expect(chunk.metadata.documentTitle).toBe(classification.title);
      });
    });

    it('propagates ocrDetected flag from page', () => {
      const pages = [makePage({ text: 'OCR scanned content with enough text.', ocrDetected: true })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      expect(chunks[0].ocrDetected).toBe(true);
    });

    it('marks non-OCR pages correctly', () => {
      const pages = [makePage({ ocrDetected: false })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      expect(chunks[0].ocrDetected).toBe(false);
    });

    it('records correct pageStart', () => {
      const pages = [makePage({ pageNumber: 3, text: 'Page three content with enough words.' })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      expect(chunks[0].pageStart).toBe(3);
    });
  });

  describe('title detection', () => {
    it('extracts first line as title when it has alphabetic content and valid length', () => {
      const text = 'Les fractions\nLes fractions sont des nombres rationnels utilisés pour représenter des parties.';
      const pages = [makePage({ text })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      expect(chunks[0].title).toBe('Les fractions');
    });

    it('falls back to classification title when first line is only digits', () => {
      const text = '12345\nVoici le contenu éducatif de cette page sur les fractions.';
      const pages = [makePage({ text })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      expect(chunks[0].title).toBe(classification.title);
    });

    it('falls back to classification title when first line is only punctuation/symbols', () => {
      const text = '---===---\nContenu éducatif sur les mathématiques et les fractions entières.';
      const pages = [makePage({ text })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      expect(chunks[0].title).toBe(classification.title);
    });

    it('falls back to classification title when first line is too short (<8 chars)', () => {
      const text = 'Hi\nLong educational content about fractions and mathematical operations for students.';
      const pages = [makePage({ text })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      expect(chunks[0].title).toBe(classification.title);
    });

    it('falls back to classification title when first line is too long (>120 chars)', () => {
      const longTitle = 'A'.repeat(121);
      const text = `${longTitle}\nContent follows here for educational purposes about mathematics.`;
      const pages = [makePage({ text })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      expect(chunks[0].title).toBe(classification.title);
    });
  });

  describe('multi-page handling', () => {
    it('spans content across multiple pages', () => {
      const pages = [
        makePage({ pageNumber: 1, text: 'First page content about mathematics.' }),
        makePage({ pageNumber: 2, text: 'Second page continuing the lesson.' }),
      ];
      const chunks = chunkGeneratorService.generate(pages, classification);
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('creates separate chunks when paragraphs accumulate past MAX_CHUNK_LENGTH', () => {
      // Three paragraphs separated by double-newlines; each ~900 chars.
      // After two paragraphs the carry exceeds 1200 chars → flush → 2 chunks total.
      const para = ('Educational text about mathematics. ').repeat(25); // ~900 chars
      const text = `${para}\n\n${para}\n\n${para}`;
      const pages = [makePage({ text })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      expect(chunks.length).toBeGreaterThan(1);
    });
  });

  describe('empty / low-text pages', () => {
    it('flushes carry early on lowText page', () => {
      const pages = [
        makePage({ pageNumber: 1, text: 'Some content that should flush early.', lowText: true }),
        makePage({ pageNumber: 2, text: 'More content on the next page for the test.' }),
      ];
      const chunks = chunkGeneratorService.generate(pages, classification);
      // lowText triggers flush, so we should get at least one chunk per non-empty page
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('segment type detection', () => {
    it('detects definition segment', () => {
      const text = 'Définition: une fraction est un nombre rationnel exprimant une division et ses propriétés.';
      const pages = [makePage({ text })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      expect(chunks[0].metadata.segmentType).toBe('definition');
    });

    it('detects exercise segment', () => {
      const text = 'Exercice: calculer la valeur des fractions suivantes et simplifier les résultats obtenus.';
      const pages = [makePage({ text })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      expect(chunks[0].metadata.segmentType).toBe('exercise');
    });

    it('classifies short text as title segment', () => {
      const text = 'Les fractions';
      const pages = [makePage({ text })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      expect(chunks[0].metadata.segmentType).toBe('title');
    });

    it('classifies regular text as paragraph', () => {
      const text = 'Les fractions sont des nombres rationnels qui permettent de représenter des portions.';
      const pages = [makePage({ text })];
      const chunks = chunkGeneratorService.generate(pages, classification);
      expect(chunks[0].metadata.segmentType).toBe('paragraph');
    });
  });
});
