import { expect, it } from 'vitest';
import { areaProgress, assignArea, dropArea, patchItem } from './hierarchy';
import { emptyBoard, removeItem, type BoardItem } from './model';
const area: BoardItem = {
  id: 'area',
  kind: 'area',
  x: 100,
  y: 100,
  width: 700,
  height: 500,
  color: 'blue',
  label: 'Project',
  noteId: null,
  notePath: null,
};
const card: BoardItem = {
  ...area,
  id: 'card',
  kind: 'card',
  x: 120,
  y: 160,
  width: 300,
  height: 180,
  progress: 50,
  noteId: 'note',
};
const board = () => ({ ...emptyBoard(), items: [area, card] });
it('attaches on explicit drop, translates children and releases them in place on removal', () => {
  expect(board().items[1].parentId).toBeUndefined();
  expect(dropArea(board(), card)?.id).toBe('area');
  const attached = assignArea(board(), 'card', 'area');
  const moved = patchItem(attached, 'area', { x: 180, y: 90 });
  expect(moved.items[1]).toMatchObject({ x: 200, y: 150, parentId: 'area' });
  const removed = removeItem(moved, 'area');
  expect(removed.items[0]).toMatchObject({ x: 200, y: 150, parentId: null, noteId: 'note' });
});
it('area growth keeps the complete activity visible and text does not count in progress', () => {
  let b = assignArea(board(), 'card', 'area');
  b = {
    ...b,
    items: [
      ...b.items,
      { ...card, id: 'second', progress: 100, parentId: 'area' },
      { ...card, id: 'text', kind: 'text', progress: 0, parentId: 'area' },
    ],
  };
  expect(areaProgress(b, 'area')).toEqual({ count: 2, progress: 75 });
  b = patchItem(b, 'card', { height: 900 });
  expect(b.items[0].y + b.items[0].height).toBeGreaterThan(b.items[1].y + 900);
  expect(areaProgress(board(), 'area')).toEqual({ count: 0, progress: null });
});
it('allows detach and rejects missing or nested area assignments', () => {
  const b = assignArea(board(), 'card', 'area');
  const moved = patchItem(b, 'card', { x: 1100 }, false);
  expect(dropArea(moved, moved.items[1])).toBeUndefined();
  expect(assignArea(moved, 'card', null).items[1].parentId).toBeNull();
  expect(assignArea(b, 'area', 'card')).toEqual(b);
  expect(assignArea(b, 'card', 'missing')).toEqual(b);
});
