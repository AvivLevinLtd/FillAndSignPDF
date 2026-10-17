import fontUrl from '../assets/fonts/Alef-Regular.ttf?url';

// One font (Alef: Hebrew + Latin) is used both on screen and in the exported
// PDF, so what the user sees while typing matches the saved file.
export const FONT_FAMILY = 'DocFont';

let bytes: Promise<Uint8Array> | null = null;

/** Register the font for on-screen editing; resolves once it is usable. */
export async function loadEditorFont(): Promise<void> {
  const face = new FontFace(FONT_FAMILY, `url(${fontUrl})`);
  document.fonts.add(await face.load());
}

/** The TTF bytes for embedding into exported PDFs (fetched once). */
export function fontBytes(): Promise<Uint8Array> {
  bytes ??= fetch(fontUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`Could not load font (${r.status})`);
      return r.arrayBuffer();
    })
    .then((b) => new Uint8Array(b));
  return bytes;
}
