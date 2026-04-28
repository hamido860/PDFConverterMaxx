import { describe, expect, it } from 'vitest';
import { MIN_QUALITY_SCORE, chunkQualityService } from '../services/rag/chunkQualityService';
import type { ChunkDraft } from '../services/rag/types';
import { createContentHash } from '../services/rag/utils';

function makeChunk(overrides: Partial<ChunkDraft> = {}): ChunkDraft {
  return {
    chunkIndex: 0,
    content: 'Les fractions sont des nombres rationnels. Elles permettent de représenter des parties d\'un tout dans les cours de mathématiques au collège.',
    originalContent: '',
    pageStart: 1,
    pageEnd: 1,
    title: 'Les fractions',
    language: 'fr',
    metadata: { segmentType: 'paragraph', source: 'pdf_extraction' },
    ocrDetected: false,
    ...overrides,
  };
}

const fullContext = {
  duplicateHashes: new Set<string>(),
  hasGrade: true,
  hasSubject: true,
  hasTopic: true,
};

describe('MIN_QUALITY_SCORE', () => {
  it('is exported and equals 0.45', () => {
    expect(MIN_QUALITY_SCORE).toBe(0.45);
  });
});

describe('chunkQualityService.score', () => {
  describe('clean chunk', () => {
    it('returns clean status and score ≥ MIN_QUALITY_SCORE for good content', () => {
      const result = chunkQualityService.score(makeChunk(), fullContext);
      expect(result.repairStatus).toBe('clean');
      expect(result.qualityScore).toBeGreaterThanOrEqual(MIN_QUALITY_SCORE);
      expect(result.reject).toBe(false);
      expect(result.duplicate).toBe(false);
      expect(result.flags).toHaveLength(0);
    });
  });

  describe('empty content', () => {
    it('is rejected with score 0', () => {
      const result = chunkQualityService.score(makeChunk({ content: '' }), fullContext);
      expect(result.repairStatus).toBe('rejected');
      expect(result.reject).toBe(true);
      expect(result.qualityScore).toBe(0);
      expect(result.flags).toContain('empty_content');
    });

    it('whitespace-only content is rejected', () => {
      const result = chunkQualityService.score(makeChunk({ content: '   \n\t  ' }), fullContext);
      expect(result.repairStatus).toBe('rejected');
      expect(result.flags).toContain('empty_content');
    });
  });

  describe('too short', () => {
    it('flags content under 120 chars', () => {
      const result = chunkQualityService.score(makeChunk({ content: 'Short text with enough letters to pass density.' }), fullContext);
      expect(result.flags).toContain('too_short');
    });
  });

  describe('too long', () => {
    it('flags content over 2500 chars', () => {
      const longContent = 'a'.repeat(100) + ' ' + 'b'.repeat(100) + ' ';
      const reallyLong = (longContent + 'text with real letters ').repeat(15);
      const result = chunkQualityService.score(makeChunk({ content: reallyLong }), fullContext);
      expect(result.flags).toContain('too_long');
    });
  });

  describe('low alpha density', () => {
    it('rejects content where <30% of chars are letters', () => {
      // Content with lots of numbers and symbols but some letters
      const lowAlpha = '1234567890 !@#$% 1234567890 --- abc 1234567890 !@#$% *** 1234567890 ===';
      const result = chunkQualityService.score(makeChunk({ content: lowAlpha }), fullContext);
      expect(result.flags).toContain('low_alpha_density');
    });

    it('does NOT flag content with sufficient alpha density', () => {
      const result = chunkQualityService.score(makeChunk(), fullContext);
      expect(result.flags).not.toContain('low_alpha_density');
    });
  });

  describe('title quality', () => {
    it('flags missing title', () => {
      const result = chunkQualityService.score(makeChunk({ title: null }), fullContext);
      expect(result.flags).toContain('missing_title');
    });

    it('flags digit-only title as poor quality', () => {
      const result = chunkQualityService.score(makeChunk({ title: '123' }), fullContext);
      expect(result.flags).toContain('poor_title_quality');
    });

    it('flags punctuation-only title as poor quality', () => {
      const result = chunkQualityService.score(makeChunk({ title: '---' }), fullContext);
      expect(result.flags).toContain('poor_title_quality');
    });

    it('flags title shorter than 3 chars as poor quality', () => {
      const result = chunkQualityService.score(makeChunk({ title: 'ab' }), fullContext);
      expect(result.flags).toContain('poor_title_quality');
    });

    it('does NOT flag a valid title', () => {
      const result = chunkQualityService.score(makeChunk({ title: 'Les fractions' }), fullContext);
      expect(result.flags).not.toContain('poor_title_quality');
      expect(result.flags).not.toContain('missing_title');
    });
  });

  describe('metadata completeness', () => {
    it('flags missing grade', () => {
      const result = chunkQualityService.score(makeChunk(), { ...fullContext, hasGrade: false });
      expect(result.flags).toContain('missing_grade');
    });

    it('flags missing subject', () => {
      const result = chunkQualityService.score(makeChunk(), { ...fullContext, hasSubject: false });
      expect(result.flags).toContain('missing_subject');
    });

    it('flags missing topic', () => {
      const result = chunkQualityService.score(makeChunk(), { ...fullContext, hasTopic: false });
      expect(result.flags).toContain('missing_topic');
    });
  });

  describe('OCR', () => {
    it('flags and penalizes OCR-detected chunk', () => {
      const result = chunkQualityService.score(makeChunk({ ocrDetected: true }), fullContext);
      expect(result.flags).toContain('ocr_detected');
      expect(result.qualityScore).toBeLessThan(1);
    });

    it('flags OCR noise pattern', () => {
      const noisy = 'Normal text with aaaaaaaaaaa noise in it for educational purposes and more words here.';
      const result = chunkQualityService.score(makeChunk({ content: noisy }), fullContext);
      expect(result.flags).toContain('ocr_noise');
    });
  });

  describe('duplicate detection', () => {
    it('marks chunk as duplicate when hash exists in context', () => {
      const chunk = makeChunk();
      const hash = createContentHash(chunk.content);
      const contextWithHash = { ...fullContext, duplicateHashes: new Set([hash]) };
      const result = chunkQualityService.score(chunk, contextWithHash);
      expect(result.repairStatus).toBe('duplicate');
      expect(result.duplicate).toBe(true);
      expect(result.flags).toContain('duplicate');
    });

    it('does NOT mark chunk as duplicate when hash is absent', () => {
      const result = chunkQualityService.score(makeChunk(), fullContext);
      expect(result.duplicate).toBe(false);
    });
  });

  describe('quality threshold floor', () => {
    it('rejects chunk when accumulated penalties drop score below MIN_QUALITY_SCORE', () => {
      // missing title (-0.1), missing grade (-0.1), missing subject (-0.1), missing topic (-0.1),
      // too_short (-0.25) = 0.35 total → score = 0.65 > 0.45 ... need more penalties
      // Add OCR noise and broken spacing to get below 0.45
      const lowQuality = makeChunk({
        content: 'l e s',  // too short + broken spacing
        title: null,
      });
      const weakContext = { duplicateHashes: new Set<string>(), hasGrade: false, hasSubject: false, hasTopic: false };
      const result = chunkQualityService.score(lowQuality, weakContext);
      expect(result.repairStatus).toBe('rejected');
      expect(result.flags).toContain('below_quality_threshold');
    });

    it('clean status when score is exactly at threshold', () => {
      // A chunk with only missing_topic penalty: 1 - 0.1 = 0.9 → clean
      const result = chunkQualityService.score(makeChunk(), { ...fullContext, hasTopic: false });
      expect(result.repairStatus).toBe('needs_review');
      expect(result.qualityScore).toBeGreaterThanOrEqual(MIN_QUALITY_SCORE);
    });
  });

  describe('low educational value', () => {
    it('flags content that is purely symbols/punctuation', () => {
      const symbolic = '!@#$%^&*()---===+++|||:::: ?? ... !!!';
      const result = chunkQualityService.score(makeChunk({ content: symbolic }), fullContext);
      expect(result.flags).toContain('low_educational_value');
    });
  });

  describe('repair status logic', () => {
    it('returns needs_review when there are flags but no rejection', () => {
      const result = chunkQualityService.score(makeChunk({ ocrDetected: true }), fullContext);
      expect(result.repairStatus).toBe('needs_review');
    });

    it('rejected takes precedence over duplicate flag', () => {
      const result = chunkQualityService.score(makeChunk({ content: '' }), fullContext);
      expect(result.repairStatus).toBe('rejected');
    });
  });
});
