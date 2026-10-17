# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, client-only web app (Vite + TypeScript, no UI framework) for filling and signing PDFs, deployed to GitHub Pages. Nothing is ever sent to a server. Hebrew/RTL text is a first-class requirement.

## Commands

```sh
npm run dev                          # dev server at http://localhost:5173/FillAndSignPDF/
npm test                             # all unit tests (Vitest, Node environment)
npx vitest run tests/bidi.test.ts    # one test file
npx vitest run -t "rotated pages"    # tests matching a name
npm run typecheck                    # tsc --noEmit
npm run build                        # typecheck + production build into dist/
```

Pushing to `main` deploys via `.github/workflows/deploy.yml` (tests → build → Pages). The site lives under `/FillAndSignPDF/`, so `base` in `vite.config.ts` must match the repo name.

## Architecture

- **Two PDF libraries, each with one job.** pdf.js (`src/pdf/viewer.ts`) only *renders* pages to canvases. pdf-lib (`src/pdf/export.ts`) only *writes* the output, by loading the original bytes and drawing items onto the pages. The export module is loaded with dynamic `import()` because pdf-lib and fontkit are about 1 MB. Keep it out of the main bundle.
- **Coordinate model.** Items (`src/model.ts`) are stored in *viewer space*: PDF points at zoom 1, top-left origin, page `/Rotate` already applied (the same as a pdf.js viewport at scale 1). Screen px = viewer pt × zoom. Converting to PDF user space happens only at export, in `src/pdf/coords.ts` (`viewerToPdf`, which handles crop-box offsets and 0/90/180/270 rotation). On rotated pages, text and images are drawn with `rotate = page rotation` so they appear upright. `tests/coords.test.ts` checks the mapping against pdf.js's own `convertToPdfPoint`.
- **Hebrew / bidi.** pdf-lib draws glyphs left to right and ignores fontkit's positions, and fontkit reverses any run it detects as RTL. So `export.ts` wraps fontkit to force `'ltr'` layout, and `src/text/bidi.ts` converts each line from logical to visual order first (UAX #9 levels from `bidi-js`, bracket mirroring, combining marks kept attached to their base letter). Don't remove either half.
- **Editor ↔ PDF fidelity.** The on-screen textarea and the exporter must agree on font, line height and alignment. Both use the Alef TTF (`src/text/font.ts`) and `LINE_HEIGHT` from `model.ts`. The textarea uses `unicode-bidi: plaintext` + `text-align: start` (each line aligns by its own direction) and `font-kerning: none` (pdf-lib applies no kerning). The exporter right-aligns RTL lines within the widest line and computes the baseline from the font's hhea metrics (`baselineOffset`). Text never wraps. Lines are split only on `\n`.
- **State.** `src/store.ts` is a small observable store. Every item change goes through `commit`/`updateItem`, which record undo history. Commits that share a `coalesceKey` (`type:<id>`, `drag:<id>:<n>`, `style:<id>`) merge into one undo step, and a group that ends where it started leaves no step.
- **Overlay.** `src/ui/overlay.ts` keeps one DOM element per item on each page's `.layer` and updates them in place, never rebuilding, so a focused textarea keeps its caret. Its padding constants (`PAD`, `CARET`) must match `.item` padding in `style.css`.
- **Images** are always normalized to trimmed PNG data URLs (`src/image.ts`, `src/ui/signature-pad.ts`), so the exporter only calls `embedPng`. Saved signatures live in `localStorage` (`fillandsign.signatures`).
- **pdf.js runtime assets** (cmaps, standard fonts, wasm, ICC profiles) are copied to `dist/pdfjs/` by `vite-plugin-static-copy` and passed to `getDocument`. pdf.js detaches the buffer it is given, so always pass `bytes.slice()`.

## Testing notes

Tests run in Node and use the pdf.js legacy build (`tests/pdfjs.ts`) to read back exported PDFs and check text positions. To check UI changes, run the dev server and open a PDF in a browser. Saving can be checked without a real download by intercepting `HTMLAnchorElement.prototype.click`.
