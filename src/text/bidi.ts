import bidiFactory from 'bidi-js';

// PDF text is drawn glyph by glyph, left to right, so Hebrew (and mixed
// Hebrew/Latin/number) lines must be converted from logical order to visual
// order before drawing. The browser does this for the on-screen editor; this
// module reproduces it for export.

const bidi = bidiFactory();

const MARK = /\p{M}/u;
const SPACE = /\s/u;

interface Cluster {
  text: string;
  level: number;
}

export interface VisualLine {
  /** The line in left-to-right visual order, with RTL brackets mirrored. */
  text: string;
  /** Paragraph base direction; RTL lines are right-aligned like the editor's. */
  rtl: boolean;
}

/** Convert one line (no '\n') from logical to visual order (UAX #9, rules L1–L4). */
export function visualLine(line: string): VisualLine {
  if (line === '') return { text: '', rtl: false };

  const { levels, paragraphs } = bidi.getEmbeddingLevels(line, 'auto');
  const baseLevel = paragraphs[0]?.level ?? 0;

  // Group each base character with its combining marks (e.g. niqqud) so that
  // reversal keeps marks attached to their base.
  const clusters: Cluster[] = [];
  let i = 0;
  for (const ch of line) {
    const level = levels[i];
    i += ch.length;
    const prev = clusters[clusters.length - 1];
    if (prev && MARK.test(ch)) {
      prev.text += ch;
      continue;
    }
    const mirrored = level % 2 === 1 ? bidi.getMirroredCharacter(ch) : null;
    clusters.push({ text: mirrored ?? ch, level });
  }

  // L1: trailing whitespace takes the paragraph level.
  for (let k = clusters.length - 1; k >= 0 && SPACE.test(clusters[k].text); k--) {
    clusters[k].level = baseLevel;
  }

  // L2: from the highest level down to the lowest odd level, reverse every
  // maximal run of clusters at that level or higher.
  let maxLevel = 0;
  let minOddLevel = Infinity;
  for (const c of clusters) {
    maxLevel = Math.max(maxLevel, c.level);
    if (c.level % 2 === 1) minOddLevel = Math.min(minOddLevel, c.level);
  }
  for (let level = maxLevel; level >= minOddLevel; level--) {
    let start = -1;
    for (let k = 0; k <= clusters.length; k++) {
      const inRun = k < clusters.length && clusters[k].level >= level;
      if (inRun && start < 0) start = k;
      if (!inRun && start >= 0) {
        reverseRange(clusters, start, k - 1);
        start = -1;
      }
    }
  }

  return { text: clusters.map((c) => c.text).join(''), rtl: baseLevel % 2 === 1 };
}

function reverseRange<T>(arr: T[], from: number, to: number): void {
  while (from < to) {
    [arr[from], arr[to]] = [arr[to], arr[from]];
    from++;
    to--;
  }
}
