import type { DocumentClassification, RepairResult } from './types';
import { clampScore } from './utils';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_KEY = process.env.OPENROUTER_KEY || '';
const FAST_MODELS = (process.env.OPENROUTER_FAST_MODELS || 'openai/gpt-4.1-mini,qwen/qwen3-30b-a3b:free')
  .split(',')
  .map(model => model.trim())
  .filter(Boolean);
const REPAIR_MODELS = (process.env.OPENROUTER_REPAIR_MODELS || 'openai/gpt-4.1,qwen/qwen3-235b-a22b')
  .split(',')
  .map(model => model.trim())
  .filter(Boolean);

async function callOpenRouterJson<T>(models: string[], messages: Array<{ role: string; content: string }>): Promise<T> {
  if (!OPENROUTER_KEY) {
    throw new Error('OPENROUTER_KEY is not configured');
  }

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'HTTP-Referer': 'http://localhost:3001',
      'X-Title': 'PDFConverterMaxx RAG Repair',
    },
    body: JSON.stringify({
      model: models[0],
      models,
      route: 'fallback',
      provider: {
        allow_fallbacks: true,
      },
      messages,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 400)}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content ?? '{}';
  const firstBrace = content.indexOf('{');
  const lastBrace = content.lastIndexOf('}');
  const candidate = firstBrace >= 0 && lastBrace > firstBrace
    ? content.slice(firstBrace, lastBrace + 1)
    : content;
  return JSON.parse(candidate) as T;
}

export const openRouterRepairService = {
  async classifyDocument(input: {
    fileName: string;
    previewText: string;
    gradeNames: string[];
    subjectNames: string[];
  }): Promise<DocumentClassification> {
    try {
      const parsed = await callOpenRouterJson<{
        grade_name: string | null;
        subject_name: string | null;
        title: string | null;
        language: string | null;
        quality_notes?: string[];
      }>(FAST_MODELS, [
        {
          role: 'system',
          content: 'You classify educational PDF text. Use only the provided grade and subject lists. Return valid JSON only.',
        },
        {
          role: 'user',
          content: [
            `Filename: ${input.fileName}`,
            `Allowed grades: ${input.gradeNames.join(', ')}`,
            `Allowed subjects: ${input.subjectNames.join(', ')}`,
            'Return JSON with keys: grade_name, subject_name, title, language, quality_notes.',
            'Rules: do not invent a grade or subject outside the lists; use null when uncertain.',
            `Preview text:\n${input.previewText.slice(0, 4000)}`
          ].join('\n\n'),
        },
      ]);

      const gradeName = input.gradeNames.includes(parsed.grade_name ?? '') ? parsed.grade_name : null;
      const subjectName = input.subjectNames.includes(parsed.subject_name ?? '') ? parsed.subject_name : null;

      return {
        gradeName,
        subjectName,
        title: parsed.title ?? null,
        language: parsed.language ?? null,
        qualityNotes: parsed.quality_notes ?? [],
      };
    } catch (error: any) {
      return {
        gradeName: null,
        subjectName: null,
        title: null,
        language: null,
        qualityNotes: [`classification_failed:${error.message}`],
      };
    }
  },

  async repairChunk(input: {
    originalContent: string;
    currentContent: string;
    gradeName: string | null;
    subjectName: string | null;
    title: string | null;
    flags: string[];
    pageStart: number | null;
    pageEnd: number | null;
  }): Promise<RepairResult> {
    const parsed = await callOpenRouterJson<{
      repaired_content: string;
      detected_language: string | null;
      suggested_title: string | null;
      suggested_metadata?: Record<string, any>;
      quality_score_after?: number;
      repair_notes?: string[];
      generated_content?: boolean;
    }>(REPAIR_MODELS, [
      {
        role: 'system',
        content: [
          'You repair OCR-damaged educational chunks.',
          'Never invent missing educational content.',
          'You may fix spacing, OCR corruption, punctuation, headings, and chunk structure.',
          'If you add content that was not clearly present, set generated_content=true.',
          'Return JSON only.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          `Grade: ${input.gradeName ?? 'unknown'}`,
          `Subject: ${input.subjectName ?? 'unknown'}`,
          `Current title: ${input.title ?? 'unknown'}`,
          `Pages: ${input.pageStart ?? '?'}-${input.pageEnd ?? '?'}`,
          `Quality flags: ${input.flags.join(', ') || 'none'}`,
          'Return keys: repaired_content, detected_language, suggested_title, suggested_metadata, quality_score_after, repair_notes, generated_content.',
          'Original OCR/raw content:',
          input.originalContent,
          'Current chunk content:',
          input.currentContent,
        ].join('\n\n'),
      },
    ]);

    return {
      repairedContent: parsed.repaired_content?.trim() || input.currentContent,
      detectedLanguage: parsed.detected_language ?? null,
      suggestedTitle: parsed.suggested_title ?? null,
      suggestedMetadata: parsed.suggested_metadata ?? {},
      qualityScoreAfter: clampScore(parsed.quality_score_after ?? 0.8),
      repairNotes: parsed.repair_notes ?? [],
      generatedContent: !!parsed.generated_content,
    };
  },
};
