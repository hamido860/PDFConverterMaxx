import { describe, expect, it } from 'vitest';
import {
  buildClassificationPrompt,
  isAllowedChoice,
  md5Browser,
  normalizeClassification,
  parseJsonObject,
  splitIntoChunks,
} from '../src/lib/pipelineUtils';

describe('pipelineUtils', () => {
  it('produces a stable browser hash for deduplication', () => {
    const first = md5Browser('hello world');
    const second = md5Browser('hello world');
    const third = md5Browser('hello world!');

    expect(first).toBe(second);
    expect(first).not.toBe(third);
    expect(first).toHaveLength(32);
  });

  it('normalizes common grade and subject aliases', () => {
    expect(normalizeClassification('1 bac', 'math')).toEqual({
      grade: '1Ã¨re annÃ©e Bac',
      subject: 'MathÃ©matiques',
    });
  });

  it('parses JSON wrapped in markdown code fences', () => {
    expect(parseJsonObject<{ grade: string; subject: string }>('```json\n{"grade":"A","subject":"B"}\n```')).toEqual({
      grade: 'A',
      subject: 'B',
    });
  });

  it('checks allowed choices case-insensitively', () => {
    expect(isAllowedChoice('mathematiques', ['MathEmatiques', 'Physics'])).toBe(true);
    expect(isAllowedChoice('History', ['MathEmatiques', 'Physics'])).toBe(false);
  });

  it('builds a constrained classification prompt', () => {
    const prompt = buildClassificationPrompt('lesson.pdf', 'fractions', ['Grade 6'], ['Math']);
    expect(prompt).toContain('lesson.pdf');
    expect(prompt).toContain('Allowed grades: [Grade 6]');
    expect(prompt).toContain('Allowed subjects: [Math]');
  });

  it('splits long text into reusable chunks', () => {
    const paragraph = 'Fractions are used to represent parts of a whole in mathematics education. '.repeat(20);
    const chunks = splitIntoChunks(`${paragraph}\n\n${paragraph}`, 300, 50);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length >= 100)).toBe(true);
  });
});
