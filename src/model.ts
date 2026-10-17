// Placed items are stored in "viewer space": PDF points at zoom 1, origin at the
// top-left of the page as displayed (i.e. with the page's /Rotate applied).
// This is exactly pdf.js's viewport at scale 1, so screen px = viewer pt * zoom.
// Conversion to PDF user space happens only at export (see pdf/coords.ts).

interface ItemBase {
  id: string;
  /** 0-based page index. */
  page: number;
  /** Top-left corner. For text, the top of the first line box. */
  x: number;
  y: number;
}

export interface TextItem extends ItemBase {
  kind: 'text';
  /** Lines separated by '\n'; no automatic wrapping. */
  text: string;
  fontSize: number;
  /** '#rrggbb' */
  color: string;
}

export interface ImageItem extends ItemBase {
  kind: 'image';
  /** PNG data URL. */
  src: string;
  width: number;
  height: number;
}

export type Item = TextItem | ImageItem;

/** CSS line-height multiplier, shared by the on-screen editor and the exporter. */
export const LINE_HEIGHT = 1.25;

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}
