import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { LINE_HEIGHT, type ImageItem, type Item, type TextItem } from '../model';
import { visualLine } from '../text/bidi';
import { normalizeRotation, viewerToPdf, type PageGeometry } from './coords';

// fontkit reverses any run it detects as RTL script, and pdf-lib keeps only the
// glyph order (not positions) from its layout. We hand it text that is already
// in visual order (text/bidi.ts), so force left-to-right layout.
type FontkitFont = ReturnType<typeof fontkit.create>;
const ltrFontkit = {
  create(buffer: Uint8Array, postscriptName?: string): FontkitFont {
    const font = fontkit.create(buffer, postscriptName);
    const layout = font.layout.bind(font) as (...args: unknown[]) => ReturnType<FontkitFont['layout']>;
    font.layout = ((str: string, features?: unknown) =>
      layout(str, features, undefined, undefined, 'ltr')) as FontkitFont['layout'];
    return font;
  },
};

export class EncryptedPdfError extends Error {
  name = 'EncryptedPdfError';
}

/**
 * Draw `items` onto a copy of the PDF and return the new file's bytes.
 * `fontBytes` is the TTF used for text (it must match the editor's font so
 * line widths and baselines line up with what the user saw).
 */
export async function exportPdf(
  pdfBytes: Uint8Array,
  items: Item[],
  fontBytes: Uint8Array,
): Promise<Uint8Array> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes);
  } catch (err) {
    if (err instanceof Error && err.name === 'EncryptedPDFError') throw new EncryptedPdfError(err.message);
    throw err;
  }

  const textItems = items.filter((i): i is TextItem => i.kind === 'text' && i.text.trim() !== '');
  const imageItems = items.filter((i): i is ImageItem => i.kind === 'image');

  if (textItems.length > 0) {
    doc.registerFontkit(ltrFontkit);
    const font = await doc.embedFont(fontBytes, { subset: true });
    const metrics = fontMetrics(ltrFontkit.create(fontBytes));
    for (const item of textItems) drawText(doc.getPage(item.page), item, font, metrics);
  }

  const images = new Map<string, PDFImage>();
  for (const item of imageItems) {
    let image = images.get(item.src);
    if (!image) {
      image = await doc.embedPng(item.src);
      images.set(item.src, image);
    }
    drawImage(doc.getPage(item.page), item, image);
  }

  return doc.save();
}

interface FontMetrics {
  /** Ascent and descent as fractions of the font size (descent negative). */
  ascent: number;
  descent: number;
}

function fontMetrics(font: FontkitFont): FontMetrics {
  return { ascent: font.ascent / font.unitsPerEm, descent: font.descent / font.unitsPerEm };
}

/** Distance from the top of a CSS line box to the baseline, for a given font size. */
export function baselineOffset(fontSize: number, m: FontMetrics): number {
  const contentHeight = (m.ascent - m.descent) * fontSize;
  return (fontSize * LINE_HEIGHT - contentHeight) / 2 + m.ascent * fontSize;
}

function pageGeometry(page: PDFPage): PageGeometry {
  // pdf.js displays the crop box clipped to the media box; match it.
  const crop = page.getCropBox();
  const media = page.getMediaBox();
  const x0 = Math.max(crop.x, media.x);
  const y0 = Math.max(crop.y, media.y);
  const x1 = Math.min(crop.x + crop.width, media.x + media.width);
  const y1 = Math.min(crop.y + crop.height, media.y + media.height);
  return { box: [x0, y0, x1, y1], rotation: page.getRotation().angle };
}

function drawText(page: PDFPage, item: TextItem, font: PDFFont, metrics: FontMetrics): void {
  const g = pageGeometry(page);
  const rotate = degrees(normalizeRotation(g.rotation));
  const lines = item.text.split('\n').map(visualLine);
  const widths = lines.map((l) => font.widthOfTextAtSize(l.text, item.fontSize));
  // Like the editor's textarea: the box is as wide as the longest line, and
  // each RTL line is right-aligned within it.
  const boxWidth = Math.max(...widths);
  const lineHeight = item.fontSize * LINE_HEIGHT;
  const baseline = baselineOffset(item.fontSize, metrics);

  lines.forEach((line, i) => {
    if (line.text.trim() === '') return;
    const vx = item.x + (line.rtl ? boxWidth - widths[i] : 0);
    const vy = item.y + i * lineHeight + baseline;
    const p = viewerToPdf(g, vx, vy);
    page.drawText(line.text, { x: p.x, y: p.y, size: item.fontSize, font, color: hexToRgb(item.color), rotate });
  });
}

function drawImage(page: PDFPage, item: ImageItem, image: PDFImage): void {
  const g = pageGeometry(page);
  // pdf-lib anchors images at their bottom-left corner.
  const p = viewerToPdf(g, item.x, item.y + item.height);
  page.drawImage(image, {
    x: p.x,
    y: p.y,
    width: item.width,
    height: item.height,
    rotate: degrees(normalizeRotation(g.rotation)),
  });
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
