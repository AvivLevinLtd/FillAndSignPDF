import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Open PDF bytes with pdf.js (Node build), as the browser app does. */
export function openWithPdfjs(bytes: Uint8Array) {
  return getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
}
