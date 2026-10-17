import { readFileSync } from 'node:fs';
import { PDFDocument, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { Item } from '../src/model';
import { exportPdf } from '../src/pdf/export';
import { openWithPdfjs } from './pdfjs';

const font = new Uint8Array(readFileSync(new URL('../src/assets/fonts/Alef-Regular.ttf', import.meta.url)));
// 2x1 red PNG
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DAwMAAAAj+Af+ggbWyAAAAAElFTkSuQmCC';

async function blankPdf(rotation = 0) {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]).setRotation(degrees(rotation));
  return doc.save();
}

async function textRuns(bytes: Uint8Array) {
  const pdf = await openWithPdfjs(bytes);
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  return content.items
    .filter((i) => 'str' in i && i.str.trim() !== '')
    .map((i) => {
      const t = (i as { str: string; transform: number[] }).transform;
      // Baseline origin in viewer space.
      const [vx, vy] = viewport.convertToViewportPoint(t[4], t[5]);
      return { str: (i as { str: string }).str, vx, vy };
    });
}

describe('exportPdf', () => {
  it('writes Latin and Hebrew text where the item is placed', async () => {
    const items: Item[] = [
      { id: 'a', kind: 'text', page: 0, x: 100, y: 200, text: 'Hello', fontSize: 20, color: '#000000' },
      { id: 'b', kind: 'text', page: 0, x: 300, y: 400, text: 'שלום', fontSize: 20, color: '#1d4ed8' },
    ];
    const runs = await textRuns(await exportPdf(await blankPdf(), items, font));

    const hello = runs.find((r) => r.str === 'Hello')!;
    expect(hello.vx).toBeCloseTo(100, 1);
    // Baseline sits inside the first line box (20pt * 1.25 = 25pt tall).
    expect(hello.vy).toBeGreaterThan(200 + 10);
    expect(hello.vy).toBeLessThan(200 + 25);

    // pdf.js may report the Hebrew run in logical or visual order.
    const hebrew = runs.find((r) => r.str === 'שלום' || r.str === 'םולש')!;
    expect(hebrew).toBeDefined();
    expect(hebrew.vx).toBeCloseTo(300, 1);
  });

  it('places text upright on rotated pages', async () => {
    for (const rotation of [90, 180, 270]) {
      const items: Item[] = [
        { id: 'a', kind: 'text', page: 0, x: 50, y: 60, text: 'Rotated', fontSize: 12, color: '#000000' },
      ];
      const runs = await textRuns(await exportPdf(await blankPdf(rotation), items, font));
      expect(runs).toHaveLength(1);
      expect(runs[0].vx).toBeCloseTo(50, 1);
      expect(runs[0].vy).toBeGreaterThan(60);
      expect(runs[0].vy).toBeLessThan(60 + 15);
    }
  });

  it('right-aligns RTL lines within a multi-line box', async () => {
    const items: Item[] = [
      { id: 'a', kind: 'text', page: 0, x: 100, y: 100, text: 'Long English line\nשלום', fontSize: 12, color: '#000000' },
    ];
    const runs = await textRuns(await exportPdf(await blankPdf(), items, font));
    const english = runs.find((r) => r.str.startsWith('Long'))!;
    const hebrew = runs.find((r) => r.str !== english.str)!;
    expect(english.vx).toBeCloseTo(100, 1);
    expect(hebrew.vx).toBeGreaterThan(130);
    expect(hebrew.vy - english.vy).toBeCloseTo(15, 1);
  });

  it('embeds images and keeps the original page count', async () => {
    const items: Item[] = [{ id: 'a', kind: 'image', page: 0, x: 10, y: 10, width: 100, height: 50, src: png }];
    const out = await exportPdf(await blankPdf(), items, font);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
    expect(out.length).toBeGreaterThan((await blankPdf()).length);
  });
});
