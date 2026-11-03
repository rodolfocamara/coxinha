import { expect, it } from 'vitest';
import { removeItem } from '../board/model';
import { fixtureBoard } from './testing';
import { restore } from './useRemoveShortcut';

it('restores a removed area with its children and edges, keeping later moves', () => {
  const before = fixtureBoard();
  const removed = removeItem(before, 'a-crm');
  const moved = {
    ...removed,
    items: removed.items.map((i) => (i.id === 'c-comm' ? { ...i, x: 900 } : i)),
  };
  const back = restore(moved, before);
  expect(back.items.find((i) => i.id === 'a-crm')).toEqual(before.items[0]);
  expect(back.items.filter((i) => i.parentId === 'a-crm').map((i) => i.id)).toEqual([
    'c-integ',
    'c-api',
  ]);
  expect(back.items.find((i) => i.id === 'c-comm')!.x).toBe(900);

  const card = restore(removeItem(before, 'c-api'), before);
  expect(card.edges.map((e) => e.id).sort()).toEqual(['e-1', 'e-2']);
  expect(card.items).toHaveLength(before.items.length);
});
