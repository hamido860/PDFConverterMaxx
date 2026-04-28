import type { ChunkDraft, ChunkQualityResult } from './types';
import {
  brokenArabicFrenchSpacingDetected,
  clampScore,
  createContentHash,
  repeatedNoiseDetected,
} from './utils';

interface QualityContext {
  duplicateHashes: Set<string>;
  hasGrade: boolean;
  hasSubject: boolean;
  hasTopic: boolean;
}

export const chunkQualityService = {
  score(chunk: ChunkDraft, context: QualityContext): ChunkQualityResult {
    const flags: string[] = [];
    let score = 1;
    let duplicate = false;
    let reject = false;

    const normalizedLength = chunk.content.trim().length;
    const contentHash = createContentHash(chunk.content);

    if (normalizedLength === 0) {
      flags.push('empty_content');
      score = 0;
      reject = true;
    }
    if (normalizedLength > 0 && normalizedLength < 120) {
      flags.push('too_short');
      score -= 0.25;
    }
    if (normalizedLength > 2500) {
      flags.push('too_long');
      score -= 0.2;
    }
    if (repeatedNoiseDetected(chunk.content)) {
      flags.push('ocr_noise');
      score -= 0.2;
    }
    if (brokenArabicFrenchSpacingDetected(chunk.content)) {
      flags.push('broken_spacing');
      score -= 0.15;
    }
    if (!chunk.title) {
      flags.push('missing_title');
      score -= 0.1;
    }
    if (!context.hasGrade) {
      flags.push('missing_grade');
      score -= 0.1;
    }
    if (!context.hasSubject) {
      flags.push('missing_subject');
      score -= 0.1;
    }
    if (!context.hasTopic) {
      flags.push('missing_topic');
      score -= 0.1;
    }
    if (chunk.ocrDetected) {
      flags.push('ocr_detected');
      score -= 0.08;
    }
    if (/^[^a-zA-Z\u0600-\u06FF0-9]+$/.test(chunk.content.trim())) {
      flags.push('low_educational_value');
      score -= 0.2;
    }
    if (context.duplicateHashes.has(contentHash)) {
      flags.push('duplicate');
      score -= 0.4;
      duplicate = true;
    }

    let repairStatus: ChunkQualityResult['repairStatus'] = 'clean';
    if (reject) {
      repairStatus = 'rejected';
    } else if (duplicate) {
      repairStatus = 'duplicate';
    } else if (flags.length > 0) {
      repairStatus = 'needs_review';
    }

    return {
      repairStatus,
      qualityScore: clampScore(score),
      duplicate,
      reject,
      flags,
      generatedContent: false,
    };
  },
};
