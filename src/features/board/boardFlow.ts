import type { CSSProperties } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { Note } from '../../lib/bindings';
import { resolveNote } from '../workspace/workspaceModel';
import { areaProgress } from './hierarchy';
import { itemLayer, type Board, type BoardItem } from './model';
import { childBounds } from './resizeBounds';

type Args = {
  board: Board;
  notes: Note[];
  measured: Map<string, { width: number; height: number }>;
  selected: string | null;
  dropTarget: string | null;
  pop: string | null;
  promote: (id: string) => void;
  rename: (id: string, label: string) => void;
  label: (item: BoardItem, note: Note | undefined) => string;
  /**
   * Nodes from the previous call, by item id. A card whose inputs did not
   * change keeps its node object, so React Flow skips it while another
   * item is dragged or resized.
   */
  cache?: Map<string, { deps: unknown[]; node: Node }>;
};

const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Board items as React Flow nodes. The node wrapper is the element React Flow
 * moves with a transform, so it carries the shared view-transition name
 * (`card-<itemId>`, class `card`): Hoje's preview and the drawer morph into it.
 */
export function boardNodes({
  board,
  notes,
  measured,
  selected,
  dropTarget,
  pop,
  promote,
  rename,
  label,
  cache,
}: Args): Node[] {
  const nodes = board.items.map((i, index) => {
    const note = resolveNote(notes, i);
    const card = i.kind !== 'area';
    const size = measured.get(i.id);
    const ariaLabel = label(i, note);
    const deps = [
      i,
      index,
      note?.title,
      note?.id,
      pop === i.id,
      selected === i.id,
      dropTarget === i.id,
      size?.width,
      size?.height,
      ariaLabel,
    ];
    const hit = card ? cache?.get(i.id) : undefined;
    if (hit && same(hit.deps, deps)) return hit.node;
    const style = {
      width: i.width,
      ...(card
        ? { viewTransitionName: `card-${i.id}`, viewTransitionClass: 'card' }
        : { height: i.height, viewTransitionName: `area-${i.id}` }),
    } as CSSProperties;
    const node = {
      id: i.id,
      type: i.kind,
      position: { x: i.x, y: i.y },
      data: card
        ? {
            item: i,
            title: note?.title ?? '',
            noteId: note?.id ?? null,
            missing: !note,
            pop: pop === i.id,
            promote: () => promote(i.id),
          }
        : {
            id: i.id,
            label: i.label,
            rename,
            color: i.color,
            ...areaProgress(board, i.id),
            dropTarget: dropTarget === i.id,
            childBounds: childBounds(board, i.id, measured),
          },
      measured: size ?? { width: i.width, height: i.height },
      width: i.width,
      height: card ? undefined : i.height,
      style,
      className: `ws-node ws-node-${i.kind}${dropTarget === i.id ? ' ws-drop-target' : ''}`,
      selected: i.id === selected,
      zIndex: itemLayer(i, index),
      ariaLabel,
      ariaRole: 'button',
    } as Node;
    if (card) cache?.set(i.id, { deps, node });
    return node;
  });
  if (cache)
    for (const id of cache.keys()) if (!board.items.some((i) => i.id === id)) cache.delete(id);
  return nodes;
}

export function boardEdges(
  board: Board,
  selectedEdge: string | null,
  fresh: string | null,
  label: (edge: { source: string; target: string }) => string
): Edge[] {
  return board.edges.map((e) => ({
    ...e,
    type: 'dependency',
    selected: e.id === selectedEdge,
    markerEnd: { type: 'arrowclosed' as never, width: 16, height: 16 },
    data: { fresh: e.id === fresh },
    ariaLabel: label(e),
  }));
}
