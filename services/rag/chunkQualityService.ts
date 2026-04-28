import type { ChunkDraft, ChunkQualityResult } from './types';
import {
  brokenArabicFrenchSpacingDetected,
  clampScore,
  createContentHash,
  repeatedNoiseDetected,
} from './utils';

export const MIN_QUALITY_SCORE = 0.45;

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

    if (!reject) {
      if (normalizedLength < 120) {
        flags.push('too_short');
        score -= 0.25;
      }
      if (normalizedLength > 2500) {
        flags.push('too_long');
        score -= 0.2;
      }

      // Alphabetic density: real educational text must be ≥30% letters
      const alphaCount = (chunk.content.match(/[a-zA-Z؀-ۿ]/g) ?? []).length;
      const alphaDensity = alphaCount / normalizedLength;
      if (alphaDensity < 0.3) {
        flags.push('low_alpha_density');
        score -= 0.3;
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
      } else {
        const t = chunk.title.trim();
        if (t.length < 3 || /^[\d\s\W]+$/.test(t)) {
          flags.push('poor_title_quality');
          score -= 0.1;
        }
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

      // Reject pure symbol/punctuation content
      if (/^[^a-zA-Z؀-ۿ0-9]+$/.test(chunk.content.trim())) {
        flags.push('low_educational_value');
        score -= 0.2;
      }

      if (context.duplicateHashes.has(contentHash)) {
        flags.push('duplicate');
        score -= 0.4;
        duplicate = true;
      }

      // Hard floor: anything below MIN_QUALITY_SCORE is not worth keeping
      if (!duplicate && clampScore(score) < MIN_QUALITY_SCORE) {
        flags.push('below_quality_threshold');
        reject = true;
      }
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
