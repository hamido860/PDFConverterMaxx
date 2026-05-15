export type DetectedLanguage = 'ar' | 'fr' | 'en' | 'unknown';
export type DocumentType = 'lesson' | 'exercise' | 'exam' | 'correction' | 'summary' | 'unknown';
export type MetadataConfidence = 'high' | 'medium' | 'low';

export interface ExtractedDocumentMetadata {
  originalFilename: string;
  normalizedName: string;
  detectedLanguage: DetectedLanguage;
  gradeLabel?: string;
  gradeSlug?: string;
  subjectLabel?: string;
  subjectSlug?: string;
  topicTitle?: string;
  documentType?: DocumentType;
  variant?: string;
  confidence: MetadataConfidence;
  warnings: string[];
}

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670]/g;

const GRADE_PATTERNS: Array<{
  slug: string;
  label: string;
  patterns: RegExp[];
}> = [
  {
    slug: '6ap',
    label: '6ème année primaire',
    patterns: [
      /(?:^|[\s\-_–—])6[\s\-_–—]*(?:e|eme|ème)?[\s\-_–—]*(?:ann[eé]e[\s\-_–—]*)?primaire(?=$|[\s\-_–—])/i,
      /sixi[eè]me[\s\-_–—]*(?:ann[eé]e[\s\-_–—]*)?primaire/i,
      /(?:^|[\s\-_–—])السادسة[\s\-_–—]*(?:ابتدائي|ابتدائية|ابتدائيه)(?=$|[\s\-_–—])/i,
      /(?:^|[\s\-_–—])6[\s\-_–—]*(?:ابتدائي|ابتدائية|ابتدائيه)(?=$|[\s\-_–—])/i,
    ],
  },
  {
    slug: '1ac',
    label: 'الأولى إعدادي',
    patterns: [
      /(?:^|[\s\-_–—])ل?(?:الأولى|الاولى|الاولي|أولى|اولى|اولي)[\s\-_–—]*(?:إعدادي|اعدادي)(?=$|[\s\-_–—])/i,
      /(?:^|[\s\-_–—])1[\s\-_–—]*(?:إعدادي|اعدادي)(?=$|[\s\-_–—])/i,
      /(?:^|[\s\-_–—])1(?:ac|ere[\s\-_–—]*college|ère[\s\-_–—]*coll[eè]ge)(?=$|[\s\-_–—])/i,
      /premi[eè]re[\s\-_–—]*ann[eé]e[\s\-_–—]*coll[eè]ge/i,
    ],
  },
  {
    slug: '2ac',
    label: 'الثانية إعدادي',
    patterns: [
      /(?:^|[\s\-_–—])ل?(?:الثانية|الثانيه|ثانية|ثانيه)[\s\-_–—]*(?:إعدادي|اعدادي)(?=$|[\s\-_–—])/i,
      /(?:^|[\s\-_–—])2[\s\-_–—]*(?:إعدادي|اعدادي|ac)(?=$|[\s\-_–—])/i,
      /(?:deuxi[eè]me|2e|2eme|2ème)[\s\-_–—]*(?:ann[eé]e[\s\-_–—]*)?coll[eè]ge/i,
    ],
  },
  {
    slug: '3ac',
    label: 'الثالثة إعدادي',
    patterns: [
      /(?:^|[\s\-_–—])ل?(?:الثالثة|الثالثه|ثالثة|ثالثه)[\s\-_–—]*(?:إعدادي|اعدادي)(?=$|[\s\-_–—])/i,
      /(?:^|[\s\-_–—])3[\s\-_–—]*(?:إعدادي|اعدادي|ac)(?=$|[\s\-_–—])/i,
      /(?:troisi[eè]me|3e|3eme|3ème)[\s\-_–—]*(?:ann[eé]e[\s\-_–—]*)?coll[eè]ge/i,
    ],
  },
];

const DOCUMENT_TYPE_PATTERNS: Array<{ type: DocumentType; patterns: RegExp[] }> = [
  { type: 'exercise', patterns: [/تمارين/iu, /تمرين/iu, /\bexercices?\b/iu] },
  { type: 'exam', patterns: [/فروض/iu, /فرض/iu, /\bdevoirs?\b/iu, /\bcontr[oô]les?\b/iu] },
  { type: 'lesson', patterns: [/درس/iu, /\bcours\b/iu] },
  { type: 'summary', patterns: [/ملخص/iu, /\br[eé]sum[eé]s?\b/iu] },
  { type: 'correction', patterns: [/تصحيح/iu, /\bcorrections?\b/iu, /\bcorrig[eé]s?\b/iu] },
];

function stripExtension(filename: string) {
  return filename.replace(/\.[^.]+$/u, '');
}

function normalizeArabic(input: string) {
  return input
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

function normalizeFilename(filename: string) {
  return stripExtension(filename)
    .normalize('NFKC')
    .replace(/[_–—]+/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectLanguage(name: string): DetectedLanguage {
  if (/[\u0600-\u06FF]/u.test(name)) return 'ar';
  if (/[éèêàâùûîïôç]|college|collège|première|premiere|deuxième|deuxieme|troisième|troisieme|controle|contrôle|exercice|devoir|cours|résumé|resume|corrigé|corrige/i.test(name)) return 'fr';
  if (/[a-z]/i.test(name)) return 'en';
  return 'unknown';
}

function findGrade(normalizedName: string) {
  const comparable = normalizeArabic(normalizedName);
  for (const grade of GRADE_PATTERNS) {
    if (grade.patterns.some(pattern => pattern.test(comparable))) {
      return { gradeLabel: grade.label, gradeSlug: grade.slug };
    }
  }
  return {};
}

function findDocumentType(normalizedName: string): DocumentType {
  const comparable = normalizeArabic(normalizedName);
  return DOCUMENT_TYPE_PATTERNS.find(item => item.patterns.some(pattern => pattern.test(comparable)))?.type ?? 'unknown';
}

function findVariant(normalizedName: string) {
  return normalizedName.match(/(?:نموذج\s*\d+|model\s*\d+|version\s*\d+)/iu)?.[0]?.replace(/\s+/g, '')?.trim();
}

function cleanupTopic(normalizedName: string, gradeSlug?: string) {
  let topic = normalizedName;

  topic = topic.replace(/(?:نموذج\s*\d+|model\s*\d+|version\s*\d+)/giu, ' ');
  topic = topic.replace(/تمارين|تمرين|فروض|فرض|درس|ملخص|تصحيح/giu, ' ');
  topic = topic.replace(/\b(?:exercices?|devoirs?|contr[oô]les?|cours|r[eé]sum[eé]s?|corrections?|corrig[eé]s?)\b/giu, ' ');
  topic = topic.replace(/\b(?:unknown[\s\-_]*(?:grade|subject)|document)\b/giu, ' ');
  topic = topic.replace(/\(\s*\d+\s*\)/gu, ' ');

  const gradePatterns = GRADE_PATTERNS.find(grade => grade.slug === gradeSlug)?.patterns ?? GRADE_PATTERNS.flatMap(grade => grade.patterns);
  for (const pattern of gradePatterns) {
    topic = topic.replace(pattern, ' ');
  }

  topic = topic
    .replace(/\b(?:pdf|doc|document)\b/giu, ' ')
    .replace(/\b(?:ann[eé]e|primaire|college|coll[eè]ge)\b/giu, ' ')
    .replace(/\b\d+\s*(?:e|eme|ème)\b/giu, ' ')
    .replace(/^ل(?=[\u0600-\u06FF])/u, '')
    .replace(/[-_–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return topic || undefined;
}

function scoreConfidence(metadata: Pick<ExtractedDocumentMetadata, 'gradeLabel' | 'topicTitle' | 'documentType' | 'subjectLabel'>): MetadataConfidence {
  if (metadata.gradeLabel && metadata.topicTitle && metadata.documentType && metadata.documentType !== 'unknown' && metadata.subjectLabel) return 'high';
  if (metadata.gradeLabel && metadata.topicTitle && metadata.documentType && metadata.documentType !== 'unknown') return 'medium';
  if (metadata.gradeLabel && metadata.topicTitle) return 'medium';
  return 'low';
}

export function extractMetadataFromFilename(filename: string): ExtractedDocumentMetadata {
  const normalizedName = normalizeFilename(filename);
  const detectedLanguage = detectLanguage(normalizedName);
  const { gradeLabel, gradeSlug } = findGrade(normalizedName);
  const documentType = findDocumentType(normalizedName);
  const variant = findVariant(normalizedName);
  const topicTitle = cleanupTopic(normalizedName, gradeSlug);
  const warnings: string[] = [];

  if (!gradeLabel) warnings.push('Grade could not be detected from the filename. Please confirm.');
  if (!topicTitle) warnings.push('Topic could not be detected from the filename. Please confirm.');
  warnings.push('Subject could not be confidently detected. Please confirm.');

  const result: ExtractedDocumentMetadata = {
    originalFilename: filename,
    normalizedName,
    detectedLanguage,
    gradeLabel,
    gradeSlug,
    subjectLabel: undefined,
    subjectSlug: undefined,
    topicTitle,
    documentType,
    variant,
    confidence: 'low',
    warnings,
  };

  result.confidence = scoreConfidence(result);
  return result;
}

export function slugifyMetadataLabel(label: string) {
  return normalizeArabic(label)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
