export interface PageGeometry {
  /** Visible page box in PDF user space: [x0, y0, x1, y1] (pdf.js `page.view`). */
  box: [number, number, number, number];
  /** Page /Rotate in degrees, clockwise. */
  rotation: number;
}

export function normalizeRotation(deg: number): 0 | 90 | 180 | 270 {
  return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}

/** Size of the page as displayed, in points. */
export function viewerSize(g: PageGeometry): { width: number; height: number } {
  const [x0, y0, x1, y1] = g.box;
  const w = x1 - x0;
  const h = y1 - y0;
  const r = normalizeRotation(g.rotation);
  return r === 90 || r === 270 ? { width: h, height: w } : { width: w, height: h };
}

/**
 * Map a viewer-space point (top-left origin, y down, rotation applied) to PDF
 * user space (bottom-left origin, y up, unrotated). Matches pdf.js
 * `viewport.convertToPdfPoint` at scale 1.
 */
export function viewerToPdf(g: PageGeometry, vx: number, vy: number): { x: number; y: number } {
  const [x0, y0, x1, y1] = g.box;
  switch (normalizeRotation(g.rotation)) {
    case 0:
      return { x: x0 + vx, y: y1 - vy };
    case 90:
      return { x: x0 + vy, y: y0 + vx };
    case 180:
      return { x: x1 - vx, y: y0 + vy };
    case 270:
      return { x: x1 - vy, y: y1 - vx };
  }
}
