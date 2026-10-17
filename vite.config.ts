import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { viteStaticCopy, type Target } from 'vite-plugin-static-copy';

// pdf.js fetches these at runtime for PDFs with CJK text, non-embedded standard
// fonts, JPEG2000 images or ICC colour profiles. Served at <base>/pdfjs/<dir>/.
const pdfjsAssets = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];

const staticFiles: Target[] = [
  ...pdfjsAssets.map((dir): Target => ({
    src: `node_modules/pdfjs-dist/${dir}/*`,
    dest: `pdfjs/${dir}`,
    rename: { stripBase: true },
  })),
  // The site serves the Alef font, so its licence must ship with it.
  { src: 'src/assets/fonts/Alef-OFL.txt', dest: 'fonts', rename: { stripBase: true } },
];

// Libraries bundled into the site's JavaScript. Minification drops their
// licence comments, so their notices are published in licenses.txt instead.
const bundledPackages = [
  'pdfjs-dist',
  'bidi-js',
  'pdf-lib',
  '@pdf-lib/fontkit',
  '@pdf-lib/standard-fonts',
  '@pdf-lib/upng',
  'pako',
  'tslib',
];

const mitLicense = (holder: string) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

function thirdPartyLicenses(): Plugin {
  return {
    name: 'third-party-licenses',
    apply: 'build',
    generateBundle() {
      const sections = bundledPackages.map((name) => {
        const dir = fileURLToPath(new URL(`node_modules/${name}/`, import.meta.url));
        const pkg = JSON.parse(readFileSync(dir + 'package.json', 'utf8'));
        const file = readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
        // @pdf-lib/fontkit ships no licence file; its package.json declares MIT.
        const text = file ? readFileSync(dir + file, 'utf8').trim() : mitLicense(String(pkg.author));
        return `${name} ${pkg.version} (${pkg.license})\n\n${text}`;
      });
      this.emitFile({
        type: 'asset',
        fileName: 'licenses.txt',
        source: sections.join(`\n\n${'-'.repeat(72)}\n\n`) + '\n',
      });
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the site from /<repo-name>/.
  base: '/FillAndSignPDF/',
  plugins: [viteStaticCopy({ targets: staticFiles }), thirdPartyLicenses()],
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
