import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// pdf.js fetches these at runtime for PDFs with CJK text, non-embedded standard
// fonts, JPEG2000 images or ICC colour profiles. Served at <base>/pdfjs/<dir>/.
const pdfjsAssets = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];

export default defineConfig({
  // GitHub Pages serves the site from /<repo-name>/.
  base: '/FillAndSignPDF/',
  plugins: [
    viteStaticCopy({
      targets: pdfjsAssets.map((dir) => ({
        src: `node_modules/pdfjs-dist/${dir}/*`,
        dest: `pdfjs/${dir}`,
        rename: { stripBase: true },
      })),
    }),
  ],
  build: {
    // pdf.js's worker and the lazily loaded exporter (pdf-lib + fontkit) are
    // big by nature; neither blocks first paint.
    chunkSizeWarningLimit: 1300,
    rollupOptions: {
      // The app plus the static legal pages linked from its start screen.
      input: ['index.html', 'accessibility.html', 'privacy.html', 'terms.html'].map((page) =>
        fileURLToPath(new URL(page, import.meta.url)),
      ),
    },
  },
  test: {
    environment: 'node',
  },
});
