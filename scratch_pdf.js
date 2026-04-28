import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

async function createDummyPdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  page.drawText('This is a test document for auto ingest automation!', {
    x: 50,
    y: 700,
    size: 20,
    font: font,
    color: rgb(0, 0, 0),
  });
  
  const pdfBytes = await pdfDoc.save();
  const dir = path.resolve(process.cwd(), 'auto_ingest_pdfs');
  if (!fs.existsSync(dir)) {
     fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'live_test.pdf'), pdfBytes);
  console.log('Dummy PDF created at', path.join(dir, 'live_test.pdf'));
}

createDummyPdf().catch(console.error);
