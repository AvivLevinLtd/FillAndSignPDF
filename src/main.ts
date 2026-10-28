import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import './style.css';
import { loadImage } from './image';
import { HIGHLIGHT_COLOR, LINE_HEIGHT, newId, type Item } from './model';
import { PasswordProtectedError, openPdf, renderPage } from './pdf/viewer';
import { Store, type State } from './store';
import { fontBytes, loadEditorFont } from './text/font';
import { MIN_IMAGE, Overlay, type PageLayer } from './ui/overlay';
import { openSignatureDialog } from './ui/signature-dialog';

interface PageView extends PageLayer {
  page: PDFPageProxy;
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  renderedZoom: number;
}

interface LoadedDoc {
  name: string;
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
  pages: PageView[];
}

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
/** Default size of a newly placed signature, in points. */
const SIGNATURE_WIDTH = 150;
const SIGNATURE_MAX_HEIGHT = 70;
/** Default size of a newly placed check mark, in points. */
const CHECK_SIZE = 14;
/** Size of a highlight placed by a plain click, in points. */
const HIGHLIGHT_WIDTH = 120;
const HIGHLIGHT_HEIGHT = 14;
const DATE_FORMAT_KEY = 'fillandsign.dateFormat';
const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD.MM.YYYY', 'D MMM YYYY', 'MMMM D, YYYY'];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  fileInput: $<HTMLInputElement>('file-input'),
  viewer: $('viewer'),
  pages: $('pages'),
  empty: $('empty'),
  hint: $('hint'),
  toast: $('toast'),
  dropOverlay: $('drop-overlay'),
  text: $<HTMLButtonElement>('btn-text'),
  sign: $<HTMLButtonElement>('btn-sign'),
  check: $<HTMLButtonElement>('btn-check'),
  date: $<HTMLButtonElement>('btn-date'),
  highlight: $<HTMLButtonElement>('btn-highlight'),
  dateFormat: $<HTMLSelectElement>('date-format'),
  undo: $<HTMLButtonElement>('btn-undo'),
  redo: $<HTMLButtonElement>('btn-redo'),
  zoomLevel: $<HTMLButtonElement>('btn-zoom-fit'),
  download: $<HTMLButtonElement>('btn-download'),
  fontSize: $<HTMLInputElement>('font-size'),
  color: $<HTMLInputElement>('text-color'),
};

const store = new Store({
  items: [],
  selectedId: null,
  tool: 'select',
  pendingImage: null,
  zoom: 1,
  fontSize: 12,
  color: '#111827',
});

let doc: LoadedDoc | null = null;
/** Items as of the last open/download, for the unsaved-changes warning. */
let savedItems: Item[] = [];

const overlay = new Overlay(store, () => doc?.pages ?? []);
const fontReady = loadEditorFont().catch(() => toast('Could not load the Hebrew font; text may look different on screen.', true));

// ---------- Opening ----------

async function openFile(file: File): Promise<void> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    toast('That is not a PDF file.', true);
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let pdf: PDFDocumentProxy;
  try {
    pdf = await openPdf(bytes);
  } catch (err) {
    toast(
      err instanceof PasswordProtectedError
        ? 'This PDF is password protected. Remove the password first, then open it here.'
        : 'Could not open this PDF. The file may be damaged.',
      true,
    );
    return;
  }

  await fontReady;
  void doc?.pdf.loadingTask.destroy();
  const pages: PageView[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const { width, height } = page.getViewport({ scale: 1 });
    const container = document.createElement('div');
    container.className = 'page';
    container.dataset.page = String(i - 1);
    const canvas = document.createElement('canvas');
    const layer = document.createElement('div');
    layer.className = 'layer';
    container.append(canvas, layer);
    pages.push({ page, container, canvas, el: layer, width, height, renderedZoom: 0 });
  }
  doc = { name: file.name, bytes, pdf, pages };
  ui.pages.replaceChildren(...pages.map((p) => p.container));
  ui.viewer.scrollTo(0, 0);
  document.body.classList.add('has-doc');
  document.title = `${file.name} · Fill & Sign PDF`;

  store.reset();
  savedItems = store.get().items;
  setZoom(fitZoom());
  for (const p of pages) visibility.observe(p.container);
}

// Render pages lazily as they scroll into view.
const visible = new Set<PageView>();
const visibility = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const view = doc?.pages[Number((e.target as HTMLElement).dataset.page)];
      if (!view) continue;
      if (e.isIntersecting) visible.add(view);
      else visible.delete(view);
    }
    renderVisible();
  },
  { root: ui.viewer, rootMargin: '600px 0px' },
);

function renderVisible(): void {
  const { zoom } = store.get();
  for (const view of visible) {
    if (view.renderedZoom === zoom) continue;
    view.renderedZoom = zoom;
    renderPage(view.page, view.canvas, zoom).catch(() => (view.renderedZoom = 0));
  }
}

// ---------- Zoom ----------

function fitZoom(): number {
  if (!doc) return 1;
  const maxWidth = Math.max(...doc.pages.map((p) => p.width));
  const available = ui.viewer.clientWidth - (window.innerWidth < 640 ? 16 : 64);
  return Math.min(1.5, Math.max(0.25, Math.floor((available / maxWidth) * 100) / 100));
}

function setZoom(zoom: number): void {
  const { scrollTop, scrollHeight } = ui.viewer;
  const ratio = scrollHeight > 0 ? scrollTop / scrollHeight : 0;
  for (const p of doc?.pages ?? []) {
    p.container.style.width = `${p.width * zoom}px`;
    p.container.style.height = `${p.height * zoom}px`;
  }
  store.set({ zoom });
  ui.viewer.scrollTop = ratio * ui.viewer.scrollHeight;
  renderVisible();
}

function stepZoom(dir: 1 | -1): void {
  const z = store.get().zoom;
  const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001);
  if (next) setZoom(next);
}

// ---------- Placing items ----------

function pointOnPage(e: MouseEvent, layer: HTMLElement) {
  const rect = layer.getBoundingClientRect();
  const { zoom } = store.get();
  return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
}

function addText(page: number, x: number, y: number, initial = ''): void {
  const { fontSize, color, items } = store.get();
  const id = newId();
  // Centre the first line vertically on the click.
  const item: Item = { id, kind: 'text', page, x, y: Math.max(0, y - (fontSize * LINE_HEIGHT) / 2), text: initial, fontSize, color };
  store.commit([...items, item], { coalesceKey: `type:${id}`, patch: { selectedId: id } });
  overlay.focusItem(id);
}

function addDate(page: number, x: number, y: number): void {
  // Keep the box: it is not empty, so leaving it does not discard it.
  addText(page, x, y, formatDate(new Date(), ui.dateFormat.value));
  store.set({ tool: 'select' });
}

function addCheck(page: number, x: number, y: number): void {
  const view = doc!.pages[page];
  const { color, items } = store.get();
  const size = CHECK_SIZE;
  const item: Item = {
    id: newId(),
    kind: 'check',
    page,
    width: size,
    height: size,
    color,
    x: clamp(x - size / 2, 0, view.width - size),
    y: clamp(y - size / 2, 0, view.height - size),
  };
  // Stay in the check tool so several boxes can be ticked in a row.
  store.commit([...items, item], { patch: { selectedId: item.id } });
}

function addHighlight(page: number, x: number, y: number, width = HIGHLIGHT_WIDTH, height = HIGHLIGHT_HEIGHT): void {
  const view = doc!.pages[page];
  const w = Math.min(width, view.width);
  const h = Math.min(height, view.height);
  const item: Item = {
    id: newId(),
    kind: 'highlight',
    page,
    width: w,
    height: h,
    color: HIGHLIGHT_COLOR,
    x: clamp(x - w / 2, 0, view.width - w),
    y: clamp(y - h / 2, 0, view.height - h),
  };
  // Stay in the tool so several passages can be marked in a row.
  store.commit([...store.get().items, item], { patch: { selectedId: item.id } });
}

// Dragging with the highlight tool draws the rectangle as the pointer moves.
let swallowClick = false;
ui.pages.addEventListener('pointerdown', (e) => {
  const layer = e.target as HTMLElement;
  if (store.get().tool !== 'highlight' || e.button !== 0 || !layer.classList.contains('layer')) return;
  const page = Number(layer.parentElement!.dataset.page);
  const view = doc!.pages[page];
  const from = pointOnPage(e, layer);
  const id = newId();
  const key = `drag:${id}:0`;
  let created = false;
  layer.setPointerCapture(e.pointerId);

  const onMove = (ev: PointerEvent) => {
    const to = pointOnPage(ev, layer);
    if (!created && Math.hypot(to.x - from.x, to.y - from.y) * store.get().zoom < 4) return;
    const x = clamp(Math.min(from.x, to.x), 0, view.width);
    const y = clamp(Math.min(from.y, to.y), 0, view.height);
    const patch = { x, y, width: clamp(Math.max(from.x, to.x), 0, view.width) - x, height: clamp(Math.max(from.y, to.y), 0, view.height) - y };
    if (!created) {
      created = true;
      const item: Item = { id, kind: 'highlight', page, color: HIGHLIGHT_COLOR, ...patch };
      store.commit([...store.get().items, item], { coalesceKey: key, patch: { selectedId: id } });
    } else store.updateItem(id, patch, key);
  };
  const onUp = () => {
    layer.removeEventListener('pointermove', onMove);
    layer.removeEventListener('pointerup', onUp);
    layer.removeEventListener('pointercancel', onUp);
    store.breakCoalescing();
    if (created) {
      swallowClick = true;
      setTimeout(() => (swallowClick = false), 0);
    }
  };
  layer.addEventListener('pointermove', onMove);
  layer.addEventListener('pointerup', onUp);
  layer.addEventListener('pointercancel', onUp);
});

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatDate(d: Date, format: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const map: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MMMM: MONTHS[d.getMonth()],
    MMM: MONTHS[d.getMonth()].slice(0, 3),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    D: String(d.getDate()),
  };
  return format.replace(/YYYY|MMMM|MMM|MM|DD|D/g, (t) => map[t]);
}

async function addImage(page: number, x: number, y: number, src: string): Promise<string> {
  const view = doc!.pages[page];
  const img = await loadImage(src);
  const aspect = img.naturalHeight / img.naturalWidth;
  let width = Math.min(SIGNATURE_WIDTH, view.width * 0.8);
  if (width * aspect > SIGNATURE_MAX_HEIGHT) width = SIGNATURE_MAX_HEIGHT / aspect;
  const height = width * aspect;
  const item: Item = {
    id: newId(),
    kind: 'image',
    page,
    src,
    width,
    height,
    x: clamp(x - width / 2, 0, view.width - width),
    y: clamp(y - height / 2, 0, view.height - height),
  };
  store.commit([...store.get().items, item], { patch: { selectedId: item.id, tool: 'select', pendingImage: null } });
  return item.id;
}

/** The point at the centre of the visible part of the viewer, on the nearest page. */
function visibleCenter(): { page: number; x: number; y: number } | null {
  if (!doc) return null;
  const v = ui.viewer.getBoundingClientRect();
  const cx = v.left + v.width / 2;
  const cy = v.top + v.height / 2;
  let page = 0;
  let best = Infinity;
  doc.pages.forEach((p, i) => {
    const r = p.el.getBoundingClientRect();
    const dist = Math.max(r.top - cy, cy - r.bottom, 0);
    if (dist < best) [page, best] = [i, dist];
  });
  const view = doc.pages[page];
  const r = view.el.getBoundingClientRect();
  const { zoom } = store.get();
  return { page, x: clamp((cx - r.left) / zoom, 0, view.width), y: clamp((cy - r.top) / zoom, 0, view.height) };
}

// Date format picker, remembered between visits and previewed with today's date.
{
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(DATE_FORMAT_KEY);
  } catch {}
  const today = new Date();
  for (const f of DATE_FORMATS) ui.dateFormat.append(new Option(`${formatDate(today, f)}`, f));
  ui.dateFormat.value = saved && DATE_FORMATS.includes(saved) ? saved : DATE_FORMATS[0];
  ui.dateFormat.addEventListener('change', () => {
    try {
      localStorage.setItem(DATE_FORMAT_KEY, ui.dateFormat.value);
    } catch {}
  });
}

// Keyboard alternatives to clicking on the page: place at the centre of the
// screen, then move with the arrow keys.
function addTextAtCenter(): void {
  const c = visibleCenter();
  if (!c) return;
  store.set({ tool: 'select', pendingImage: null });
  addText(c.page, clamp(c.x - 60, 0, doc!.pages[c.page].width - 40), c.y);
}

function addAtCenter(kind: 'check' | 'date' | 'highlight'): void {
  const c = visibleCenter();
  if (!c) return;
  store.set({ tool: 'select', pendingImage: null });
  if (kind === 'check') addCheck(c.page, c.x, c.y);
  else if (kind === 'highlight') addHighlight(c.page, c.x, c.y);
  else addDate(c.page, clamp(c.x - 30, 0, doc!.pages[c.page].width - 60), c.y);
}

async function addImageAtCenter(src: string): Promise<void> {
  const c = visibleCenter();
  if (!c) return;
  overlay.focusItem(await addImage(c.page, c.x, c.y, src));
}

ui.pages.addEventListener('click', (e) => {
  const layer = e.target as HTMLElement;
  if (!layer.classList.contains('layer') || swallowClick) return;
  const page = Number(layer.parentElement!.dataset.page);
  const { x, y } = pointOnPage(e, layer);
  const { tool, pendingImage } = store.get();
  if (tool === 'text') addText(page, x, y);
  else if (tool === 'check') addCheck(page, x, y);
  else if (tool === 'date') addDate(page, x, y);
  else if (tool === 'highlight') addHighlight(page, x, y);
  else if (tool === 'image' && pendingImage) void addImage(page, x, y, pendingImage);
  else store.set({ selectedId: null });
});

ui.pages.addEventListener('dblclick', (e) => {
  const layer = e.target as HTMLElement;
  if (!layer.classList.contains('layer') || store.get().tool !== 'select') return;
  const { x, y } = pointOnPage(e, layer);
  addText(Number(layer.parentElement!.dataset.page), x, y);
});

// Preview of the signature following the pointer while placing it.
const ghost = document.createElement('img');
ghost.className = 'ghost';
ghost.alt = '';
ghost.hidden = true;
document.body.append(ghost);
ui.pages.addEventListener('pointermove', (e) => {
  const { tool, pendingImage, zoom } = store.get();
  const show = tool === 'image' && !!pendingImage && e.pointerType === 'mouse';
  ghost.hidden = !show;
  if (!show) return;
  if (ghost.getAttribute('src') !== pendingImage) ghost.src = pendingImage;
  ghost.style.width = `${SIGNATURE_WIDTH * zoom}px`;
  ghost.style.maxHeight = `${SIGNATURE_MAX_HEIGHT * zoom}px`;
  ghost.style.left = `${e.clientX}px`;
  ghost.style.top = `${e.clientY}px`;
});
ui.pages.addEventListener('pointerleave', () => (ghost.hidden = true));

/** `placeNow`: put the signature at the centre of the screen instead of waiting for a click. */
async function chooseSignature(placeNow = false): Promise<void> {
  if (!doc) return;
  if (store.get().tool === 'image') {
    store.set({ tool: 'select', pendingImage: null });
    return;
  }
  const src = await openSignatureDialog();
  if (!src) return;
  if (placeNow) await addImageAtCenter(src);
  else store.set({ tool: 'image', pendingImage: src, selectedId: null });
}

function toggleTool(tool: 'text' | 'check' | 'date' | 'highlight'): void {
  if (!doc) return;
  store.set({ tool: store.get().tool === tool ? 'select' : tool, pendingImage: null });
}
const toggleTextTool = () => toggleTool('text');

// ---------- Text properties ----------

function selectedText() {
  const { items, selectedId } = store.get();
  const item = items.find((i) => i.id === selectedId);
  return item?.kind === 'text' ? item : null;
}

ui.fontSize.addEventListener('input', () => {
  const fontSize = clamp(Number(ui.fontSize.value) || 12, 4, 96);
  store.set({ fontSize });
  const item = selectedText();
  if (item) store.updateItem(item.id, { fontSize }, `style:${item.id}`);
});

ui.color.addEventListener('input', () => {
  const color = ui.color.value;
  store.set({ color });
  const item = selectedText();
  if (item) store.updateItem(item.id, { color }, `style:${item.id}`);
});

// ---------- Saving ----------

async function download(): Promise<void> {
  if (!doc) return;
  // Blur first so an open, empty text box is discarded before export.
  (document.activeElement as HTMLElement | null)?.blur();
  ui.download.disabled = true;
  // pdf-lib and fontkit are large and only needed here, so load them on demand.
  try {
    const { exportPdf } = await import('./pdf/export');
    const out = await exportPdf(doc.bytes, store.get().items, await fontBytes());
    const name = doc.name.replace(/\.pdf$/i, '') + '-signed.pdf';
    const url = URL.createObjectURL(new Blob([out as BlobPart], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    savedItems = store.get().items;
    toast(`Saved ${name}`);
  } catch (err) {
    console.error(err);
    toast(
      err instanceof Error && err.name === 'EncryptedPdfError'
        ? 'This PDF is locked against changes by its author, so it cannot be saved with your additions.'
        : 'Something went wrong while saving the PDF.',
      true,
    );
  } finally {
    ui.download.disabled = false;
  }
}

// ---------- UI state ----------

function onState(state: State): void {
  overlay.render(state);
  ui.text.classList.toggle('active', state.tool === 'text');
  ui.sign.classList.toggle('active', state.tool === 'image');
  ui.check.classList.toggle('active', state.tool === 'check');
  ui.date.classList.toggle('active', state.tool === 'date');
  ui.highlight.classList.toggle('active', state.tool === 'highlight');
  ui.pages.dataset.tool = state.tool;
  ui.undo.disabled = !store.canUndo();
  ui.redo.disabled = !store.canRedo();
  ui.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
  if (document.activeElement !== ui.fontSize) ui.fontSize.value = String(state.fontSize);
  ui.color.value = state.color;
  if (state.tool !== 'image') ghost.hidden = true;

  const hint =
    state.tool === 'text'
      ? 'Click anywhere on the page to type, or press Enter to add text in the middle of the screen. Esc cancels.'
      : state.tool === 'check'
        ? 'Click each checkbox to tick it, or press Enter to add a check in the middle of the screen. Esc when done.'
        : state.tool === 'date'
          ? "Click where today's date should go, or press Enter to add it in the middle of the screen. Esc cancels."
          : state.tool === 'highlight'
          ? 'Drag over the text to highlight it, or click to drop a marker bar. Esc when done.'
          : state.tool === 'image'
        ? 'Click where the signature should go, or press Enter to place it in the middle of the screen. Esc cancels.'
        : '';
  if (hint !== ui.hint.textContent) {
    ui.hint.textContent = hint;
    ui.hint.hidden = !hint;
  }
}
store.subscribe(onState);
onState(store.get());

let toastTimer = 0;
function toast(message: string, error = false): void {
  ui.toast.textContent = message;
  ui.toast.classList.toggle('error', error);
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (ui.toast.hidden = true), error ? 6000 : 3000);
}

// ---------- Wiring ----------

const pickFile = () => ui.fileInput.click();
$('btn-open').addEventListener('click', pickFile);
$('btn-open-empty').addEventListener('click', pickFile);
ui.fileInput.addEventListener('change', () => {
  const file = ui.fileInput.files?.[0];
  ui.fileInput.value = '';
  if (file) void openFile(file);
});
// A click with detail 0 came from the keyboard (Enter/Space on the button):
// there is no pointer to place with, so place at the centre of the screen.
ui.text.addEventListener('click', (e) => (e.detail === 0 ? addTextAtCenter() : toggleTextTool()));
ui.check.addEventListener('click', (e) => (e.detail === 0 ? addAtCenter('check') : toggleTool('check')));
ui.date.addEventListener('click', (e) => (e.detail === 0 ? addAtCenter('date') : toggleTool('date')));
ui.highlight.addEventListener('click', (e) => (e.detail === 0 ? addAtCenter('highlight') : toggleTool('highlight')));
ui.sign.addEventListener('click', (e) => void chooseSignature(e.detail === 0));
ui.undo.addEventListener('click', () => store.undo());
ui.redo.addEventListener('click', () => store.redo());
$('btn-zoom-in').addEventListener('click', () => stepZoom(1));
$('btn-zoom-out').addEventListener('click', () => stepZoom(-1));
ui.zoomLevel.addEventListener('click', () => setZoom(fitZoom()));
ui.download.addEventListener('click', () => void download());

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const target = e.target as HTMLElement;
  const typing = target.matches('input, textarea, select, [contenteditable]');
  if (document.querySelector('dialog[open]')) return;

  if (mod && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    pickFile();
    return;
  }
  if (!doc) return;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void download();
    return;
  }
  if (mod && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
    e.preventDefault();
    if (e.key === '0') setZoom(fitZoom());
    else stepZoom(e.key === '-' ? -1 : 1);
    return;
  }
  if (typing) {
    if (e.key === 'Escape') target.blur();
    return; // let fields handle their own keys, including native text undo
  }
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo();
    return;
  }
  if (mod || e.altKey) return;

  const state = store.get();
  const selected = state.items.find((i) => i.id === state.selectedId);
  switch (e.key) {
    case 'Enter':
      if (target.closest('button, a')) return; // let the focused control handle it
      if (state.tool === 'check' || state.tool === 'date' || state.tool === 'highlight') {
        e.preventDefault();
        addAtCenter(state.tool);
      } else if (state.tool === 'text') {
        e.preventDefault();
        addTextAtCenter();
      } else if (state.tool === 'image' && state.pendingImage) {
        e.preventDefault();
        void addImageAtCenter(state.pendingImage);
      }
      break;
    case '+':
    case '=':
    case '-':
    case '_': {
      if (!selected || selected.kind === 'text') return;
      e.preventDefault();
      const view = doc.pages[selected.page];
      const aspect = selected.height / selected.width;
      const factor = e.key === '+' || e.key === '=' ? 1.1 : 1 / 1.1;
      const maxWidth = Math.min(view.width - selected.x, (view.height - selected.y) / aspect);
      const width = clamp(selected.width * factor, MIN_IMAGE, Math.max(MIN_IMAGE, maxWidth));
      store.updateItem(selected.id, { width, height: width * aspect }, `size:${selected.id}`);
      break;
    }
    case 'Escape':
      if (state.tool !== 'select') store.set({ tool: 'select', pendingImage: null });
      else store.set({ selectedId: null });
      break;
    case 'Delete':
    case 'Backspace':
      if (selected) {
        e.preventDefault();
        store.removeItem(selected.id);
        // Keep keyboard focus in the document rather than losing it to <body>.
        if (target.closest('.item')) ui.viewer.focus({ preventScroll: true });
      }
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown': {
      if (!selected) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      store.updateItem(selected.id, { x: Math.max(0, selected.x + dx), y: Math.max(0, selected.y + dy) }, `nudge:${selected.id}`);
      break;
    }
    case 't':
    case 'T':
      toggleTextTool();
      break;
    case 'c':
    case 'C':
      toggleTool('check');
      break;
    case 'd':
    case 'D':
      toggleTool('date');
      break;
    case 'h':
    case 'H':
      toggleTool('highlight');
      break;
    case 's':
    case 'S':
      void chooseSignature();
      break;
  }
});

// Drag and drop a PDF anywhere on the page.
let dragDepth = 0;
const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  ui.dropOverlay.hidden = false;
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    ui.dropOverlay.hidden = true;
  }
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  ui.dropOverlay.hidden = true;
  const file = e.dataTransfer?.files[0];
  if (file) void openFile(file);
});

window.addEventListener('beforeunload', (e) => {
  const { items } = store.get();
  if (items.length > 0 && items !== savedItems) e.preventDefault();
});

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
