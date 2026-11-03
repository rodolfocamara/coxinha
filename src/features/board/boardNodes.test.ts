import { expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { fixtureBoard } from '../workspace/testing';
import { patchItem } from './hierarchy';
import { boardNodes } from './boardNodes';

it('keeps the node object of every card the change did not touch', () => {
  const cache = new Map<string, { deps: unknown[]; node: Node }>();
  const args = {
    notes: [],
    measured: new Map(),
    selected: null,
    dropTarget: null,
    pop: null,
    promote: () => undefined,
    rename: () => undefined,
    label: () => 'label',
    cache,
  };
  const board = fixtureBoard();
  const first = boardNodes({ ...args, board });
  const moved = patchItem(board, 'c-comm', { x: 700 }, false);
  const second = boardNodes({ ...args, board: moved });
  const byId = (nodes: Node[], id: string) => nodes.find((n) => n.id === id);
  expect(byId(second, 'c-api')).toBe(byId(first, 'c-api'));
  expect(byId(second, 't-idea')).toBe(byId(first, 't-idea'));
  expect(byId(second, 'c-comm')).not.toBe(byId(first, 'c-comm'));
  expect(byId(second, 'c-comm')!.position).toEqual({ x: 700, y: 92 });
  const selected = boardNodes({ ...args, board: moved, selected: 'c-api' });
  expect(byId(selected, 'c-api')).not.toBe(byId(second, 'c-api'));
  boardNodes({ ...args, board: { ...moved, items: moved.items.filter((i) => i.id !== 't-idea') } });
  expect(cache.has('t-idea')).toBe(false);
});
