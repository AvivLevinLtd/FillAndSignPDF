import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const assets = `${import.meta.env.BASE_URL}pdfjs/`;

export class PasswordProtectedError extends Error {}

export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  try {
    return await pdfjs.getDocument({
      // pdf.js transfers (detaches) the buffer it is given; keep ours intact for export.
      data: bytes.slice(),
      cMapUrl: `${assets}cmaps/`,
      standardFontDataUrl: `${assets}standard_fonts/`,
      wasmUrl: `${assets}wasm/`,
      iccUrl: `${assets}iccs/`,
    }).promise;
  } catch (err) {
    if (err instanceof Error && err.name === 'PasswordException') throw new PasswordProtectedError(err.message);
    throw err;
  }
}

const tasks = new WeakMap<HTMLCanvasElement, RenderTask>();

/** Render a page into `canvas` at `zoom`, cancelling any render already running on it. */
export async function renderPage(page: PDFPageProxy, canvas: HTMLCanvasElement, zoom: number): Promise<void> {
  tasks.get(canvas)?.cancel();
  const dpr = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: zoom * dpr });
  const scratch = document.createElement('canvas');
  scratch.width = Math.floor(viewport.width);
  scratch.height = Math.floor(viewport.height);
  const task = page.render({ canvas: scratch, viewport });
  tasks.set(canvas, task);
  try {
    await task.promise;
  } catch (err) {
    if (err instanceof Error && err.name === 'RenderingCancelledException') return;
    throw err;
  }
  // Swap in the finished bitmap at once so zooming never shows a blank page.
  canvas.width = scratch.width;
  canvas.height = scratch.height;
  canvas.getContext('2d')!.drawImage(scratch, 0, 0);
}
