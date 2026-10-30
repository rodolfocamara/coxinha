import { expect, it } from 'vitest';
import { boardGeometryChanges } from './boardGeometryChanges';
import { childBounds, containsChildren } from './resizeBounds';
import { emptyBoard, type BoardItem } from './model';
const area: BoardItem = {
  id: 'area',
  kind: 'area',
  x: 0,
  y: 0,
  width: 700,
  height: 500,
  color: 'blue',
  label: '',
  noteId: null,
  notePath: null,
};
const card: BoardItem = {
  ...area,
  id: 'card',
  kind: 'card',
  x: 40,
  y: 80,
  width: 300,
  height: 200,
  parentId: 'area',
};
const board = () => ({ ...emptyBoard(), items: [area, card] });
it('resizes from the top left without translating the children', () => {
  const b = boardGeometryChanges(
    board(),
    [
      { type: 'position', id: 'area', position: { x: -100, y: -60 } },
      { type: 'dimensions', id: 'area', dimensions: { width: 800, height: 560 }, resizing: true },
    ],
    new Map()
  );
  expect(b.items[0]).toMatchObject({ x: -100, y: -60, width: 800, height: 560 });
  expect(b.items[1]).toEqual(card);
  const moved = boardGeometryChanges(
    b,
    [{ type: 'position', id: 'area', position: { x: 0, y: 0 }, dragging: true }],
    new Map()
  );
  expect(moved.items[1]).toMatchObject({ x: 140, y: 140, parentId: 'area' });
});
it('persists explicit activity dimensions and grows the containing area', () => {
  const b = boardGeometryChanges(
    board(),
    [{ type: 'dimensions', id: 'card', dimensions: { width: 800, height: 600 }, resizing: true }],
    new Map()
  );
  expect(b.items[1]).toMatchObject({ width: 800, height: 600, parentId: 'area' });
  expect(b.items[0]).toMatchObject({ width: 856, height: 696 });
});
it('read-only measurements never publish new board state', () => {
  const b = board(),
    measured = new Map();
  expect(
    boardGeometryChanges(
      b,
      [{ type: 'dimensions', id: 'card', dimensions: { width: 300, height: 400 } }],
      measured
    )
  ).toBe(b);
  expect(measured.get('card')?.height).toBe(400);
});
it('area limits use rendered child size, including full content beyond stored height', () => {
  const bounds = childBounds(board(), 'area', new Map([['card', { width: 300, height: 600 }]]));
  expect(containsChildren({ x: 0, y: 0, width: 400, height: 700 }, bounds)).toBe(true);
  expect(containsChildren({ x: 0, y: 0, width: 400, height: 500 }, bounds)).toBe(false);
  expect(containsChildren({ x: 30, y: 0, width: 400, height: 700 }, bounds)).toBe(false);
});

it('settles content wrapping after explicit resize without enabling writes for untouched cards', () => {
  const resized = new Set<string>(),
    measured = new Map();
  let b = boardGeometryChanges(
    board(),
    [{ type: 'dimensions', id: 'card', dimensions: { width: 220, height: 200 }, resizing: true }],
    measured,
    undefined,
    resized
  );
  b = boardGeometryChanges(
    b,
    [{ type: 'dimensions', id: 'card', dimensions: { width: 220, height: 650 } }],
    measured,
    undefined,
    resized
  );
  expect(b.items[1].height).toBe(650);
  expect(b.items[0].height).toBe(746);
});
