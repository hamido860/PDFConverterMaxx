import crypto from 'crypto';

export function normalizeChunkContent(content: string): string {
  return content
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function createContentHash(content: string): string {
  const normalized = normalizeChunkContent(content);
  return crypto.createHash('md5').update(normalized).digest('hex');
}

export function parseVector(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map(Number).filter(Number.isFinite);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(Number).filter(Number.isFinite);
      }
    } catch {
      const cleaned = trimmed.replace(/^\[/, '').replace(/\]$/, '');
      return cleaned
        .split(',')
        .map(part => Number(part.trim()))
        .filter(Number.isFinite);
    }
  }

  return [];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function repeatedNoiseDetected(content: string): boolean {
  return /(.)\1{7,}/.test(content) || /[^\p{L}\p{N}\s]{6,}/u.test(content);
}

export function brokenArabicFrenchSpacingDetected(content: string): boolean {
  const frenchSpacing = /\b[a-zA-Z]\s+[a-zA-Z]\s+[a-zA-Z]\b/.test(content);
  const arabicSpacing = /[\u0600-\u06FF]\s+[\u0600-\u06FF]\s+[\u0600-\u06FF]/.test(content);
  return frenchSpacing || arabicSpacing;
}

export function detectGeneratedContent(originalContent: string, repairedContent: string): boolean {
  const originalTokens = new Set(
    normalizeChunkContent(originalContent)
      .toLowerCase()
      .split(/\s+/)
      .filter(token => token.length > 2)
  );
  const repairedTokens = normalizeChunkContent(repairedContent)
    .toLowerCase()
    .split(/\s+/)
    .filter(token => token.length > 2);

  if (repairedTokens.length === 0) return false;

  let unseenTokens = 0;
  for (const token of repairedTokens) {
    if (!originalTokens.has(token)) {
      unseenTokens++;
    }
  }

  const tokenDrift = unseenTokens / repairedTokens.length;
  const lengthGrowth = repairedContent.length > originalContent.length * 1.2;
  return tokenDrift > 0.35 && lengthGrowth;
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

export function toBooleanFilter(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
