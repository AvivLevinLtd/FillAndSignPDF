import { LINE_HEIGHT, type ImageItem, type Item, type TextItem } from '../model';
import type { State, Store } from '../store';
import { FONT_FAMILY } from '../text/font';

/** Wrapper padding around an item's content, in screen px (the drag border). */
const PAD = 6;
/** Horizontal textarea padding that leaves room for the caret, in screen px. */
const CARET = 1;
export const MIN_IMAGE = 12;

export interface PageLayer {
  el: HTMLElement;
  /** Displayed page size in points (zoom 1). */
  width: number;
  height: number;
}

interface Entry {
  el: HTMLElement;
  kind: Item['kind'];
}

const measureCtx = document.createElement('canvas').getContext('2d')!;

/** Width of the widest line in screen px, measured with the editor font. */
function measureLines(text: string, fontPx: number): number {
  measureCtx.font = `${fontPx}px ${FONT_FAMILY}`;
  measureCtx.fontKerning = 'none';
  return Math.max(0, ...text.split('\n').map((l) => measureCtx.measureText(l).width));
}

/**
 * Keeps one DOM element per item, positioned over its page. Elements are
 * updated in place (never rebuilt) so a textarea keeps focus and caret while
 * the user types.
 */
export class Overlay {
  private entries = new Map<string, Entry>();
  private dragSession = 0;

  constructor(
    private store: Store,
    private layers: () => PageLayer[],
  ) {}

  render(state: State): void {
    const layers = this.layers();
    const seen = new Set<string>();
    for (const item of state.items) {
      const layer = layers[item.page];
      if (!layer) continue;
      seen.add(item.id);
      let entry = this.entries.get(item.id);
      if (!entry || entry.kind !== item.kind) {
        entry?.el.remove();
        entry = { el: item.kind === 'text' ? this.createText(item.id) : this.createImage(item.id), kind: item.kind };
        this.entries.set(item.id, entry);
      }
      if (entry.el.parentElement !== layer.el) layer.el.append(entry.el);
      entry.el.classList.toggle('selected', item.id === state.selectedId);
      if (item.kind === 'text') this.updateText(entry.el, item, state.zoom);
      else this.updateImage(entry.el, item, state.zoom);
    }
    for (const [id, entry] of this.entries) {
      if (!seen.has(id)) {
        entry.el.remove();
        this.entries.delete(id);
      }
    }
  }

  /** Focus an item: a text box's textarea, or an image's wrapper. */
  focusItem(id: string): void {
    const el = this.entries.get(id)?.el;
    (el?.querySelector('textarea') ?? el)?.focus();
  }

  private item(id: string): Item | undefined {
    return this.store.get().items.find((i) => i.id === id);
  }

  private createText(id: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'item item-text';
    el.innerHTML = `
      <textarea dir="auto" rows="1" wrap="off" spellcheck="false" autocomplete="off"></textarea>
      <button type="button" class="item-delete" title="Delete (Del)">×</button>`;
    const ta = el.querySelector('textarea')!;
    ta.style.fontFamily = FONT_FAMILY;
    ta.style.lineHeight = String(LINE_HEIGHT);
    ta.style.padding = `0 ${CARET}px`;

    ta.addEventListener('focus', () => {
      const item = this.item(id);
      if (item?.kind === 'text') this.store.set({ selectedId: id, fontSize: item.fontSize, color: item.color });
    });
    ta.addEventListener('input', () => {
      this.store.updateItem(id, { text: ta.value }, `type:${id}`);
    });
    ta.addEventListener('blur', () => {
      // Drop empty boxes; same coalescing key, so a box opened and left empty
      // leaves no undo step.
      const item = this.item(id);
      if (item?.kind === 'text' && item.text.trim() === '') this.store.removeItem(id, `type:${id}`);
      this.store.breakCoalescing();
    });
    this.wireCommon(el, id);
    return el;
  }

  private updateText(el: HTMLElement, item: TextItem, zoom: number): void {
    const ta = el.querySelector('textarea')!;
    const fontPx = item.fontSize * zoom;
    if (ta.value !== item.text) ta.value = item.text;
    const lines = item.text.split('\n').length;
    const width = Math.max(measureLines(item.text, fontPx), fontPx * 0.6);
    Object.assign(ta.style, {
      fontSize: `${fontPx}px`,
      color: item.color,
      width: `${width + 2 * CARET}px`,
      height: `${lines * fontPx * LINE_HEIGHT}px`,
    });
    // The textarea's content box starts at the item's (x, y).
    el.style.left = `${item.x * zoom - PAD - CARET}px`;
    el.style.top = `${item.y * zoom - PAD}px`;
  }

  private createImage(id: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'item item-image';
    el.tabIndex = 0;
    el.innerHTML = `
      <img alt="" draggable="false">
      <button type="button" class="item-delete" title="Delete (Del)">×</button>
      <div class="item-resize" title="Drag to resize (or press + and −)"></div>`;
    el.querySelector('.item-resize')!.addEventListener('pointerdown', (e) => this.startResize(e as PointerEvent, id));
    // Tabbing to an image selects it, so the keyboard shortcuts act on it.
    el.addEventListener('focus', () => this.store.set({ selectedId: id }));
    this.wireCommon(el, id);
    return el;
  }

  private updateImage(el: HTMLElement, item: ImageItem, zoom: number): void {
    const img = el.querySelector('img')!;
    if (img.getAttribute('src') !== item.src) img.src = item.src;
    Object.assign(el.style, {
      left: `${item.x * zoom - PAD}px`,
      top: `${item.y * zoom - PAD}px`,
      width: `${item.width * zoom + 2 * PAD}px`,
      height: `${item.height * zoom + 2 * PAD}px`,
    });
  }

  /** Delete button, plus dragging by the border (text) or anywhere (image). */
  private wireCommon(el: HTMLElement, id: string): void {
    el.querySelector('.item-delete')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.store.removeItem(id);
    });
    el.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('textarea, .item-delete, .item-resize') || e.button !== 0) return;
      this.startDrag(e, id, el);
    });
  }

  private startDrag(e: PointerEvent, id: string, el: HTMLElement): void {
    const start = this.item(id);
    if (!start) return;
    e.preventDefault();
    e.stopPropagation();
    const isText = start.kind === 'text';
    if (isText) this.store.set({ selectedId: id, fontSize: start.fontSize, color: start.color });
    else this.store.set({ selectedId: id });
    if (!isText) el.focus({ preventScroll: true });

    const key = `drag:${id}:${++this.dragSession}`;
    const { zoom } = this.store.get();
    const layer = this.layers()[start.page];
    let moved = false;
    el.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - e.clientX;
      const dy = ev.clientY - e.clientY;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      const w = start.kind === 'image' ? start.width : 0;
      const h = start.kind === 'image' ? start.height : 0;
      const x = clamp(start.x + dx / zoom, 0, Math.max(0, layer.width - Math.max(w, 4)));
      const y = clamp(start.y + dy / zoom, 0, Math.max(0, layer.height - Math.max(h, 4)));
      this.store.updateItem(id, { x, y }, key);
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      this.store.breakCoalescing();
      // A click on a text box's border (no drag) means "edit this".
      if (!moved && isText) this.focusItem(id);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  private startResize(e: PointerEvent, id: string): void {
    const start = this.item(id);
    if (start?.kind !== 'image') return;
    e.preventDefault();
    e.stopPropagation();
    this.store.set({ selectedId: id });
    const handle = e.currentTarget as HTMLElement;
    const key = `resize:${id}:${++this.dragSession}`;
    const { zoom } = this.store.get();
    const layer = this.layers()[start.page];
    const aspect = start.height / start.width;
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      // Follow whichever axis moved further, keeping the aspect ratio.
      const dx = (ev.clientX - e.clientX) / zoom;
      const dy = (ev.clientY - e.clientY) / zoom;
      const grow = Math.abs(dx) > Math.abs(dy) ? dx : dy / aspect;
      const maxWidth = Math.min(layer.width - start.x, (layer.height - start.y) / aspect);
      const width = clamp(start.width + grow, MIN_IMAGE, maxWidth);
      this.store.updateItem(id, { width, height: width * aspect }, key);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      this.store.breakCoalescing();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
