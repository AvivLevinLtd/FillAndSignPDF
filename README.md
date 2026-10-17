# FillAndSignPDF

A web app for filling in and signing PDF documents, right in the browser. Open a PDF, type text anywhere on it (Hebrew, English or mixed), add your signature (drawn or uploaded), and download a new PDF.

Nothing is uploaded: the PDF, your text and your signature stay on your device. Saved signatures are kept only in your browser's local storage.

## Using it

1. **Open** a PDF, or drop it onto the page.
2. **Text** (`T`): click anywhere on the page and type. Press Enter for a new line. Set the font size and color in the toolbar. Drag a box by its border to move it.
3. **Signature** (`S`): draw one with your mouse, pen or finger, or upload an image. Uploaded images can have their white background made transparent. Then click where it should go, drag it to move it, and drag its corner to resize it. Tick "Save for next time" to reuse it later.
4. **Download PDF** (`Ctrl/Cmd+S`) saves `<name>-signed.pdf`.

Other shortcuts: double-click the page to add text, `Del` removes the selected item, arrow keys nudge it (`Shift` moves 10 pt at a time), `Ctrl/Cmd+Z` undoes, and `Esc` exits the current tool.

Password-protected PDFs, and PDFs locked against editing, can't be modified.

## Development

```sh
npm install
npm run dev        # http://localhost:5173/FillAndSignPDF/
npm test           # unit tests (Vitest)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

## Deployment

Every push to `main` runs the tests, builds the app, and publishes it to GitHub Pages (`.github/workflows/deploy.yml`). One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.

The site is served at `https://<owner>.github.io/FillAndSignPDF/`. If you rename the repository, update `base` in `vite.config.ts` to match.

## Credits

Text is set in [Alef](https://alef.hagilda.com/) by HaGilda & Mushon Zer-Aviv, under the SIL Open Font License (`src/assets/fonts/Alef-OFL.txt`). PDF rendering uses [pdf.js](https://mozilla.github.io/pdf.js/), and PDF writing uses [pdf-lib](https://pdf-lib.js.org/).
