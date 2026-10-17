import { PDFDocument, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { viewerSize, viewerToPdf, type PageGeometry } from '../src/pdf/coords';
import { openWithPdfjs } from './pdfjs';

describe('viewerToPdf', () => {
  it.each([0, 90, 180, 270])('matches pdf.js viewport mapping for /Rotate %i with an offset crop box', async (rotation) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.setCropBox(50, 30, 400, 500);
    page.setRotation(degrees(rotation));
    const pdf = await openWithPdfjs(await doc.save());
    const pdfPage = await pdf.getPage(1);
    const viewport = pdfPage.getViewport({ scale: 1 });

    const g: PageGeometry = { box: pdfPage.view as PageGeometry['box'], rotation: pdfPage.rotate };
    expect(viewerSize(g)).toEqual({ width: viewport.width, height: viewport.height });

    for (const [vx, vy] of [[0, 0], [10, 20], [viewport.width, viewport.height], [123.5, 45.25]]) {
      const [ex, ey] = viewport.convertToPdfPoint(vx, vy);
      const p = viewerToPdf(g, vx, vy);
      expect(p.x).toBeCloseTo(ex, 6);
      expect(p.y).toBeCloseTo(ey, 6);
    }
  });
});
