import path from 'path';
import { chunkGeneratorService } from './chunkGeneratorService';
import { chunkQualityService } from './chunkQualityService';
import { embeddingService } from './embeddingService';
import { ocrService } from './ocrService';
import { openRouterRepairService } from './openRouterRepairService';
import { pdfExtractionService } from './pdfExtractionService';
import { supabaseRagService } from './supabaseRagService';
import type { ChunkDraft, ChunkQualityResult } from './types';
import { createContentHash, detectGeneratedContent, sleep } from './utils';
import { MIN_QUALITY_SCORE } from './chunkQualityService';

const MIN_POST_REPAIR_SCORE = 0.5;

// Delay between consecutive OpenRouter repair calls (free tier rate limiting)
const REPAIR_DELAY_MS = Number(process.env.OPENROUTER_DELAY_MS ?? 5000);
// Delay between consecutive Gemini embedding calls
const EMBED_DELAY_MS = Number(process.env.GEMINI_EMBED_DELAY_MS ?? 5000);

async function classifyAndResolve(fileName: string, previewText: string) {
  const [gradeNames, subjectNames] = await Promise.all([
    supabaseRagService.listGradeNames(),
    supabaseRagService.listSubjectNames(),
  ]);

  return openRouterRepairService.classifyDocument({
    fileName,
    previewText,
    gradeNames,
    subjectNames,
  });
}

export async function processRagExtractionJob(jobId: string, documentId: string, filePath: string) {
  const fileName = path.basename(filePath);

  try {
    await supabaseRagService.updateJob(jobId, {
      status: 'extracting',
      started_at: new Date().toISOString(),
      error_message: null,
    });
    await supabaseRagService.appendJobLog(jobId, `Starting extraction for ${fileName}`);

    const extraction = await pdfExtractionService.extract(filePath);
    await supabaseRagService.updateDocument(documentId, {
      total_pages: extraction.totalPages,
      extraction_mode: extraction.extractionMode,
    });
    await supabaseRagService.appendJobLog(jobId, `Extracted ${extraction.totalPages} page(s) using ${extraction.extractionMode} mode.`);

    let pages = extraction.pages;
    if (extraction.extractionMode !== 'text') {
      await supabaseRagService.updateJob(jobId, { status: 'ocr_running' });
      const ocr = await ocrService.run(pages);
      pages = ocr.pages;
      for (const log of ocr.logs) {
        await supabaseRagService.appendJobLog(jobId, log, log.includes('No visual OCR engine') ? 'warn' : 'info');
      }
    }

    const previewText = pages.map(page => page.text).join('\n').slice(0, 5000);
    const classification = await classifyAndResolve(fileName, previewText);
    await supabaseRagService.updateDocument(documentId, {
      detected_grade_name: classification.gradeName,
      detected_subject_name: classification.subjectName,
      title: classification.title,
      language: classification.language,
      metadata: {
        quality_notes: classification.qualityNotes,
      },
    });

    await supabaseRagService.updateJob(jobId, { status: 'chunking' });
    const chunkDrafts = chunkGeneratorService.generate(pages, classification);
    await supabaseRagService.appendJobLog(jobId, `Generated ${chunkDrafts.length} raw chunk(s).`);

    await supabaseRagService.updateJob(jobId, { status: 'quality_scan' });
    const existingHashes = await supabaseRagService.getExistingHashes(documentId);
    const scannedChunks: Array<ChunkDraft & { quality: ChunkQualityResult }> = [];

    for (const draft of chunkDrafts) {
      const quality = chunkQualityService.score(draft, {
        duplicateHashes: existingHashes,
        hasGrade: !!classification.gradeName,
        hasSubject: !!classification.subjectName,
        hasTopic: !!classification.title,
      });

      scannedChunks.push({ ...draft, quality });
      existingHashes.add(createContentHash(draft.content));
    }

    const insertedChunks: any[] = [];
    for (const scanned of scannedChunks) {
      const chunk = await supabaseRagService.insertChunk({
        document_id: documentId,
        chunk_index: scanned.chunkIndex,
        content: scanned.content,
        original_content: scanned.originalContent,
        page_start: scanned.pageStart,
        page_end: scanned.pageEnd,
        title: scanned.title,
        language: scanned.language,
        quality_score: scanned.quality.qualityScore,
        repair_status: scanned.quality.repairStatus,
        is_active: scanned.quality.repairStatus !== 'rejected',
        metadata: {
          ...scanned.metadata,
          quality_flags: scanned.quality.flags,
          generated_content: false,
          topic_label: classification.title,
        },
        ocr_detected: scanned.ocrDetected,
        is_duplicate: scanned.quality.duplicate,
        grade_name: classification.gradeName,
        subject_name: classification.subjectName,
        topic_title: classification.title,
      });
      insertedChunks.push(chunk);
    }

    const rejectedCount = scannedChunks.filter(c => c.quality.reject).length;
    const duplicateCount = scannedChunks.filter(c => c.quality.duplicate).length;
    const reviewCount = scannedChunks.filter(c => c.quality.repairStatus === 'needs_review').length;
    const cleanCount = scannedChunks.filter(c => c.quality.repairStatus === 'clean').length;
    await supabaseRagService.appendJobLog(
      jobId,
      `Quality scan: ${cleanCount} clean, ${reviewCount} needs_review, ${duplicateCount} duplicate, ${rejectedCount} rejected (threshold=${MIN_QUALITY_SCORE}).`,
    );
    await supabaseRagService.appendJobLog(jobId, `Saved ${insertedChunks.length} chunk row(s) to Supabase.`);

    await supabaseRagService.updateJob(jobId, { status: 'repairing' });
    for (const chunk of insertedChunks) {
      if (chunk.repair_status !== 'needs_review') {
        continue;
      }

      try {
        const repair = await openRouterRepairService.repairChunk({
          originalContent: chunk.original_content || chunk.content,
          currentContent: chunk.content,
          gradeName: classification.gradeName,
          subjectName: classification.subjectName,
          title: chunk.title,
          flags: chunk.metadata?.quality_flags ?? [],
          pageStart: chunk.page_start,
          pageEnd: chunk.page_end,
        });

        const generatedContent = repair.generatedContent || detectGeneratedContent(chunk.original_content || chunk.content, repair.repairedContent);

        // Reject if repair didn't bring the chunk above the minimum bar
        const postRepairStatus = repair.qualityScoreAfter < MIN_POST_REPAIR_SCORE ? 'rejected' : 'auto_repaired';
        if (postRepairStatus === 'rejected') {
          await supabaseRagService.appendJobLog(
            jobId,
            `Chunk ${chunk.id} rejected after repair: post-repair score ${repair.qualityScoreAfter.toFixed(2)} < ${MIN_POST_REPAIR_SCORE}.`,
            'warn',
          );
        }

        await supabaseRagService.saveChunkEdits({
          chunkId: chunk.id,
          content: repair.repairedContent,
          title: repair.suggestedTitle ?? chunk.title,
          language: repair.detectedLanguage ?? chunk.language,
          gradeName: classification.gradeName,
          subjectName: classification.subjectName,
          topicTitle: classification.title,
          metadata: {
            ...(chunk.metadata ?? {}),
            repair_notes: repair.repairNotes,
            suggested_metadata: repair.suggestedMetadata,
            generated_content: generatedContent,
            quality_score_after_repair: repair.qualityScoreAfter,
          },
          repairStatus: postRepairStatus,
          reviewNotes: repair.repairNotes,
        });
      } catch (error: any) {
        await supabaseRagService.appendJobLog(jobId, `Repair failed for chunk ${chunk.id}: ${error.message}`, 'warn');
      }

      await sleep(REPAIR_DELAY_MS);
    }

    await supabaseRagService.updateJob(jobId, { status: 'embedding' });
    const activeChunks = await supabaseRagService.listChunks({ documentId });
    for (const chunk of activeChunks) {
      if (!chunk.is_active) continue;
      if (!['clean', 'embedded', 'auto_repaired'].includes(chunk.repair_status)) continue;
      if (!chunk.content_hash) continue;

      try {
        const embedding = await embeddingService.embedText(chunk.content);
        await supabaseRagService.saveEmbedding(chunk.id, embedding, process.env.RAG_EMBEDDING_MODEL || 'gemini-embedding-exp-03-07');
      } catch (error: any) {
        await supabaseRagService.markEmbeddingFailed(chunk.id, error.message);
        await supabaseRagService.appendJobLog(jobId, `Embedding failed for chunk ${chunk.id}: ${error.message}`, 'warn');
      }

      await sleep(EMBED_DELAY_MS);
    }

    await supabaseRagService.updateJob(jobId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
    await supabaseRagService.appendJobLog(jobId, `Completed extraction workflow for ${fileName}`);
  } catch (error: any) {
    await supabaseRagService.updateJob(jobId, {
      status: 'failed',
      error_message: error.message,
      completed_at: new Date().toISOString(),
    });
    await supabaseRagService.appendJobLog(jobId, `Pipeline failed: ${error.message}`, 'error');
    throw error;
  }
}
