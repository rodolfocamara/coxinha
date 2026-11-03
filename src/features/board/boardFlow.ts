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
  label: (item: BoardItem, note: Note | undefined) => string;
};

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
  label,
}: Args): Node[] {
  return board.items.map((i, index) => {
    const note = resolveNote(notes, i);
    const card = i.kind !== 'area';
    const style = {
      width: i.width,
      ...(card
        ? { viewTransitionName: `card-${i.id}`, viewTransitionClass: 'card' }
        : { height: i.height, viewTransitionName: `area-${i.id}` }),
    } as CSSProperties;
    return {
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
            label: i.label,
            color: i.color,
            ...areaProgress(board, i.id),
            dropTarget: dropTarget === i.id,
            childBounds: childBounds(board, i.id, measured),
          },
      measured: measured.get(i.id) ?? { width: i.width, height: i.height },
      width: i.width,
      height: card ? undefined : i.height,
      style,
      className: `ws-node ws-node-${i.kind}${dropTarget === i.id ? ' ws-drop-target' : ''}`,
      selected: i.id === selected,
      zIndex: itemLayer(i, index),
      ariaLabel: label(i, note),
      ariaRole: 'button',
    } as Node;
  });
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
