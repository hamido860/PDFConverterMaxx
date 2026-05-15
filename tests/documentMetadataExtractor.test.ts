import { describe, expect, it } from 'vitest';
import { extractMetadataFromFilename } from '../src/lib/documentMetadataExtractor';

describe('extractMetadataFromFilename', () => {
  it('extracts Arabic exercise metadata from a first-year college filename', () => {
    const metadata = extractMetadataFromFilename('تمارين-معالجة-المياه-لأولى-إعدادي-نموذج1.pdf');

    expect(metadata).toMatchObject({
      detectedLanguage: 'ar',
      documentType: 'exercise',
      gradeLabel: 'الأولى إعدادي',
      topicTitle: 'معالجة المياه',
      variant: 'نموذج1',
      confidence: 'medium',
    });
  });

  it('extracts Arabic lesson metadata for second-year college', () => {
    const metadata = extractMetadataFromFilename('درس-الهواء-الثانية-إعدادي.pdf');

    expect(metadata).toMatchObject({
      detectedLanguage: 'ar',
      documentType: 'lesson',
      gradeLabel: 'الثانية إعدادي',
      gradeSlug: '2ac',
      topicTitle: 'الهواء',
    });
  });

  it('extracts French controle metadata for first-year college', () => {
    const metadata = extractMetadataFromFilename('controle-electricite-1ere-college.pdf');

    expect(metadata).toMatchObject({
      detectedLanguage: 'fr',
      documentType: 'exam',
      gradeLabel: 'الأولى إعدادي',
      gradeSlug: '1ac',
      topicTitle: 'electricite',
    });
  });

  it('extracts underscored French exercise metadata for 1ac', () => {
    const metadata = extractMetadataFromFilename('exercices_traitement_des_eaux_1ac.pdf');

    expect(metadata).toMatchObject({
      documentType: 'exercise',
      gradeLabel: 'الأولى إعدادي',
      gradeSlug: '1ac',
      topicTitle: 'traitement des eaux',
    });
  });

  it('extracts Arabic summary metadata for third-year college', () => {
    const metadata = extractMetadataFromFilename('ملخص-التغذية-الثالثة-إعدادي.pdf');

    expect(metadata).toMatchObject({
      detectedLanguage: 'ar',
      documentType: 'summary',
      gradeLabel: 'الثالثة إعدادي',
      gradeSlug: '3ac',
      topicTitle: 'التغذية',
    });
  });

  it('ignores placeholder tokens around a sixth primary grade filename', () => {
    const metadata = extractMetadataFromFilename('6ème année primaire_UnknownGrade_6ème année primaire_UnknownGrade_UnknownSubject_Document (90).pdf');

    expect(metadata).toMatchObject({
      detectedLanguage: 'fr',
      documentType: 'unknown',
      gradeLabel: '6ème année primaire',
      gradeSlug: '6ap',
      confidence: 'low',
    });
    expect(metadata.topicTitle).toBeUndefined();
    expect(metadata.warnings).toContain('Topic could not be detected from the filename. Please confirm.');
    expect(metadata.warnings).toContain('Subject could not be confidently detected. Please confirm.');
  });
});
