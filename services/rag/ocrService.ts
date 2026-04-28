import type { ExtractedPage } from './types';

export const ocrService = {
  async run(pages: ExtractedPage[]): Promise<{ pages: ExtractedPage[]; logs: string[] }> {
    const logs: string[] = [];
    const repairedPages = pages.map(page => {
      if (!page.lowText) {
        return page;
      }

      logs.push(`Page ${page.pageNumber}: OCR requested because extracted text was too short (${page.extractedTextLength} chars).`);
      logs.push(`Page ${page.pageNumber}: No visual OCR engine is configured in this workspace, so the original low-text extraction was preserved for human review.`);

      return {
        ...page,
        ocrDetected: true,
      };
    });

    return { pages: repairedPages, logs };
  },
};
