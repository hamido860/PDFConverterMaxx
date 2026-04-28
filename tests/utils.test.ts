import { describe, expect, it } from 'vitest';
import {
  brokenArabicFrenchSpacingDetected,
  clampScore,
  cosineSimilarity,
  createContentHash,
  detectGeneratedContent,
  normalizeChunkContent,
  repeatedNoiseDetected,
  toBooleanFilter,
} from '../services/rag/utils';

describe('normalizeChunkContent', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeChunkContent('  hello  ')).toBe('hello');
  });

  it('collapses multiple spaces/tabs into one', () => {
    expect(normalizeChunkContent('a\t\t b')).toBe('a b');
  });

  it('strips carriage returns', () => {
    expect(normalizeChunkContent('a\r\nb')).toBe('a\nb');
  });

  it('collapses 3+ newlines into double newline', () => {
    expect(normalizeChunkContent('a\n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('createContentHash', () => {
  it('returns 32-char hex string', () => {
    expect(createContentHash('hello')).toMatch(/^[a-f0-9]{32}$/);
  });

  it('same content → same hash', () => {
    expect(createContentHash('test content')).toBe(createContentHash('test content'));
  });

  it('normalizes before hashing (extra spaces → same hash)', () => {
    expect(createContentHash('a  b')).toBe(createContentHash('a b'));
  });

  it('different content → different hash', () => {
    expect(createContentHash('hello')).not.toBe(createContentHash('world'));
  });
});

describe('clampScore', () => {
  it('clamps below 0 to 0', () => {
    expect(clampScore(-0.5)).toBe(0);
  });

  it('clamps above 1 to 1', () => {
    expect(clampScore(1.5)).toBe(1);
  });

  it('rounds to 3 decimal places', () => {
    expect(clampScore(0.12345)).toBe(0.123);
  });

  it('returns 0 for all non-finite values (NaN, Infinity, -Infinity)', () => {
    expect(clampScore(NaN)).toBe(0);
    expect(clampScore(Infinity)).toBe(0);
    expect(clampScore(-Infinity)).toBe(0);
  });

  it('passes valid values through', () => {
    expect(clampScore(0.75)).toBe(0.75);
    expect(clampScore(0)).toBe(0);
    expect(clampScore(1)).toBe(1);
  });
});

describe('cosineSimilarity', () => {
  it('identical unit vectors → 1', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
  });

  it('orthogonal vectors → 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('opposite vectors → -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('empty arrays → 0', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('mismatched lengths → 0', () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });

  it('zero vector → 0', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('repeatedNoiseDetected', () => {
  it('detects 8+ same characters in a row', () => {
    expect(repeatedNoiseDetected('aaaaaaaa')).toBe(true);
  });

  it('does not flag 7 same characters', () => {
    expect(repeatedNoiseDetected('aaaaaaa')).toBe(false);
  });

  it('detects 6+ consecutive non-word symbols', () => {
    expect(repeatedNoiseDetected('------')).toBe(true);
  });

  it('passes clean text', () => {
    expect(repeatedNoiseDetected('Normal educational text about mathematics.')).toBe(false);
  });
});

describe('brokenArabicFrenchSpacingDetected', () => {
  it('detects French OCR spacing (single letters separated by spaces)', () => {
    expect(brokenArabicFrenchSpacingDetected('l e s')).toBe(true);
  });

  it('passes normal French text', () => {
    expect(brokenArabicFrenchSpacingDetected('les mathématiques sont importantes')).toBe(false);
  });

  it('detects Arabic OCR spacing', () => {
    expect(brokenArabicFrenchSpacingDetected('ا ل م')).toBe(true);
  });

  it('passes normal Arabic text', () => {
    expect(brokenArabicFrenchSpacingDetected('الرياضيات مهمة جداً')).toBe(false);
  });
});

describe('detectGeneratedContent', () => {
  it('returns false when repaired content is similar to original', () => {
    const original = 'The quick brown fox jumps over the lazy dog';
    const repaired = 'The quick brown fox jumps over the lazy dog.';
    expect(detectGeneratedContent(original, repaired)).toBe(false);
  });

  it('returns true when repaired content is mostly new tokens and much longer', () => {
    const original = 'short text';
    const repaired =
      'This is an entirely fabricated paragraph containing many completely different words that were never present in the source material and the length has grown significantly beyond the original.';
    expect(detectGeneratedContent(original, repaired)).toBe(true);
  });

  it('returns false for empty repaired content', () => {
    expect(detectGeneratedContent('some original text', '')).toBe(false);
  });
});

describe('toBooleanFilter', () => {
  it('converts string "true" to boolean true', () => {
    expect(toBooleanFilter('true')).toBe(true);
  });

  it('converts string "false" to boolean false', () => {
    expect(toBooleanFilter('false')).toBe(false);
  });

  it('passes boolean true', () => {
    expect(toBooleanFilter(true)).toBe(true);
  });

  it('passes boolean false', () => {
    expect(toBooleanFilter(false)).toBe(false);
  });

  it('returns undefined for unrecognized values', () => {
    expect(toBooleanFilter('yes')).toBeUndefined();
    expect(toBooleanFilter(null)).toBeUndefined();
    expect(toBooleanFilter(undefined)).toBeUndefined();
    expect(toBooleanFilter(1)).toBeUndefined();
  });
});
