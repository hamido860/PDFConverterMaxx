export type RagChunkStatus =
  | 'clean'
  | 'needs_review'
  | 'auto_repaired'
  | 'rejected'
  | 'embedded'
  | 'embedding_failed'
  | 'duplicate';

export type RagJobStatus =
  | 'pending'
  | 'extracting'
  | 'ocr_running'
  | 'chunking'
  | 'quality_scan'
  | 'repairing'
  | 'embedding'
  | 'completed'
  | 'failed';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  extractedTextLength: number;
  lowText: boolean;
  ocrDetected: boolean;
}

export interface ExtractionResult {
  fileName: string;
  pages: ExtractedPage[];
  totalPages: number;
  extractionMode: 'text' | 'scanned' | 'hybrid';
}

export interface DocumentClassification {
  gradeName: string | null;
  subjectName: string | null;
  title: string | null;
  language: string | null;
  qualityNotes: string[];
}

export interface ChunkDraft {
  chunkIndex: number;
  content: string;
  originalContent: string;
  pageStart: number;
  pageEnd: number;
  title: string | null;
  language: string | null;
  metadata: Record<string, any>;
  ocrDetected: boolean;
}

export interface ChunkQualityResult {
  repairStatus: RagChunkStatus;
  qualityScore: number;
  duplicate: boolean;
  reject: boolean;
  flags: string[];
  generatedContent: boolean;
}

export interface RepairResult {
  repairedContent: string;
  detectedLanguage: string | null;
  suggestedTitle: string | null;
  suggestedMetadata: Record<string, any>;
  qualityScoreAfter: number;
  repairNotes: string[];
  generatedContent: boolean;
}

export interface ChunkFilters {
  documentId?: string;
  gradeId?: string;
  subjectId?: string;
  status?: string;
  minQualityScore?: number;
  ocrDetected?: boolean;
  duplicate?: boolean;
}

export interface RetrievalHit {
  chunkId: string;
  score: number;
  title: string | null;
  content: string;
  documentId: string | null;
}
