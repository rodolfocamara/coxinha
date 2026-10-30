import { describe, it, expect } from 'vitest';
import { connect, emptyBoard, removeItem, type BoardItem } from './model';
const card = (id: string): BoardItem => ({
  id,
  kind: 'card',
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  color: 'neutral',
  label: '',
  noteId: id,
  notePath: `notes/${id}.md`,
});
describe('board operations', () => {
  it('removes only the visual item and incident dependencies, retaining unrelated notes', () => {
    const b = {
      ...emptyBoard(),
      items: [card('a'), card('b'), card('c')],
      edges: [
        { id: 'ab', source: 'a', target: 'b' },
        { id: 'bc', source: 'b', target: 'c' },
      ],
    };
    const next = removeItem(b, 'a');
    expect(next.items.map((i) => i.noteId)).toEqual(['b', 'c']);
    expect(next.edges.map((e) => e.id)).toEqual(['bc']);
    expect(b.items).toHaveLength(3);
  });
  it('allows directed card dependencies but rejects self links, duplicate links and areas', () => {
    const b = {
      ...emptyBoard(),
      items: [card('a'), card('b'), { ...card('area'), kind: 'area' as const }],
    };
    const next = connect(b, 'a', 'b');
    expect(next.edges).toHaveLength(1);
    expect(connect(next, 'a', 'b')).toBe(next);
    expect(connect(b, 'a', 'a')).toBe(b);
    expect(connect(b, 'a', 'area')).toBe(b);
    expect(connect(b, 'unknown', 'a')).toBe(b);
  });
});

it('reorders only peers and keeps every area below every card even at the supported size limit', async () => {
  const { reorderItem, itemLayer } = await import('./model');
  const area = { ...card('area'), kind: 'area' as const };
  const b = { ...emptyBoard(), items: [card('a'), area, card('b')] };
  const front = reorderItem(b, 'a', 'front');
  expect(front.items.map((i) => i.id)).toEqual(['b', 'area', 'a']);
  expect(reorderItem(front, 'a', 'back')).toEqual(b);
  expect(itemLayer(area, 9999)).toBeLessThan(itemLayer(card('a'), 0));
  expect(b.items[0].id).toBe('a');
});
