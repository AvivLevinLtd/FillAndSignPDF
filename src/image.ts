// Every image placed on a page is normalised to a trimmed PNG data URL, so the
// exporter only ever has to embed PNGs (transparency included).

const MAX_DIMENSION = 1200;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read this image.'));
    img.src = src;
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Turn an uploaded image (any browser-readable format) into a PNG, optionally
 * making a white/near-white background transparent (for scanned signatures).
 */
export async function processUpload(file: File, removeWhite: boolean): Promise<string> {
  const img = await loadImage(await readFileAsDataUrl(file));
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (removeWhite) whiteToTransparent(ctx, canvas.width, canvas.height);
  return trimCanvas(canvas).toDataURL('image/png');
}

/** Fade pixels to transparent as they approach white; keeps ink edges smooth. */
function whiteToTransparent(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const data = ctx.getImageData(0, 0, width, height);
  const px = data.data;
  const solid = 190; // at or below this brightness: fully opaque
  const clear = 240; // at or above: fully transparent
  for (let i = 0; i < px.length; i += 4) {
    const brightness = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (brightness >= clear) px[i + 3] = 0;
    else if (brightness > solid) px[i + 3] = Math.round((px[i + 3] * (clear - brightness)) / (clear - solid));
  }
  ctx.putImageData(data, 0, 0);
}

/** Crop away fully transparent margins, leaving `padding` px around the content. */
export function trimCanvas(canvas: HTMLCanvasElement, padding = 4): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const px = ctx.getImageData(0, 0, width, height).data;
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return canvas; // nothing drawn
  left = Math.max(0, left - padding);
  top = Math.max(0, top - padding);
  right = Math.min(width - 1, right + padding);
  bottom = Math.min(height - 1, bottom + padding);
  const out = document.createElement('canvas');
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext('2d')!.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
