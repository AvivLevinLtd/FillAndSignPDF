import type { Item } from './model';

export type Tool = 'select' | 'text' | 'image';

export interface State {
  items: Item[];
  selectedId: string | null;
  tool: Tool;
  /** PNG data URL waiting to be placed while tool === 'image'. */
  pendingImage: string | null;
  zoom: number;
  /** Defaults for new text items; also edited for the selected text item. */
  fontSize: number;
  color: string;
}

type Listener = (state: State) => void;

const HISTORY_LIMIT = 100;

/**
 * Minimal observable store. Changes to `items` go through `commit`, which
 * records undo history; consecutive commits with the same `coalesceKey` (one
 * drag, one typing session) collapse into a single undo step.
 */
export class Store {
  private state: State;
  private listeners = new Set<Listener>();
  private undoStack: Item[][] = [];
  private redoStack: Item[][] = [];
  private lastCoalesceKey: string | null = null;

  constructor(initial: State) {
    this.state = initial;
  }

  get(): State {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Update non-history state (selection, tool, zoom, defaults). */
  set(patch: Partial<State>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  commit(items: Item[], opts: { coalesceKey?: string; patch?: Partial<State> } = {}): void {
    const key = opts.coalesceKey ?? null;
    if (key === null || key !== this.lastCoalesceKey) {
      this.undoStack.push(this.state.items);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    }
    this.redoStack = [];
    this.lastCoalesceKey = key;
    // A coalesced group that ends where it started (e.g. a text box opened and
    // closed without typing) leaves no undo step behind.
    if (key !== null && sameItems(this.undoStack[this.undoStack.length - 1], items)) this.undoStack.pop();
    this.state = { ...this.state, ...opts.patch, items };
    this.emit();
  }

  updateItem(id: string, patch: Partial<Item>, coalesceKey?: string): void {
    const items = this.state.items.map((i) => (i.id === id ? ({ ...i, ...patch } as Item) : i));
    this.commit(items, { coalesceKey });
  }

  removeItem(id: string, coalesceKey?: string): void {
    const items = this.state.items.filter((i) => i.id !== id);
    const selectedId = this.state.selectedId === id ? null : this.state.selectedId;
    this.commit(items, { coalesceKey, patch: { selectedId } });
  }

  /** End the current coalescing group so the next commit starts a new undo step. */
  breakCoalescing(): void {
    this.lastCoalesceKey = null;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.state.items);
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.state.items);
    this.restore(next);
  }

  /** Replace all items without history (e.g. when a new PDF is opened). */
  reset(items: Item[] = []): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastCoalesceKey = null;
    this.state = { ...this.state, items, selectedId: null, tool: 'select', pendingImage: null };
    this.emit();
  }

  private restore(items: Item[]): void {
    this.lastCoalesceKey = null;
    const selectedId = items.some((i) => i.id === this.state.selectedId) ? this.state.selectedId : null;
    this.state = { ...this.state, items, selectedId };
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}

/** Items are immutable, so unchanged items keep their identity. */
function sameItems(a: Item[] | undefined, b: Item[]): boolean {
  return !!a && a.length === b.length && a.every((item, i) => item === b[i]);
}
