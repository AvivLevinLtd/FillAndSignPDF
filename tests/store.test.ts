import { describe, expect, it } from 'vitest';
import type { TextItem } from '../src/model';
import { Store } from '../src/store';

const text = (id: string, t = ''): TextItem => ({ id, kind: 'text', page: 0, x: 0, y: 0, text: t, fontSize: 12, color: '#000000' });
const store = () =>
  new Store({ items: [], selectedId: null, tool: 'select', pendingImage: null, zoom: 1, fontSize: 12, color: '#000000' });

describe('Store history', () => {
  it('coalesces a typing session into one undo step', () => {
    const s = store();
    s.commit([text('a')], { coalesceKey: 'type:a' });
    s.updateItem('a', { text: 'h' }, 'type:a');
    s.updateItem('a', { text: 'hi' }, 'type:a');
    s.undo();
    expect(s.get().items).toEqual([]);
    s.redo();
    expect((s.get().items[0] as TextItem).text).toBe('hi');
  });

  it('leaves no undo step for a box opened and removed without typing', () => {
    const s = store();
    s.commit([text('a', 'keep')]);
    s.commit([...s.get().items, text('b')], { coalesceKey: 'type:b' });
    s.removeItem('b', 'type:b');
    expect(s.get().items.map((i) => i.id)).toEqual(['a']);
    s.undo();
    expect(s.get().items).toEqual([]);
  });

  it('starts a new step after breakCoalescing', () => {
    const s = store();
    s.commit([text('a', 'x')], { coalesceKey: 'k' });
    s.breakCoalescing();
    s.updateItem('a', { text: 'y' }, 'k');
    s.undo();
    expect((s.get().items[0] as TextItem).text).toBe('x');
  });
});
