export type Color = 'neutral' | 'orange' | 'green' | 'blue' | 'purple';
export type BoardItem = {
  id: string;
  kind: 'card' | 'area' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  color: Color;
  label: string;
  progress?: number;
  parentId?: string | null;
  noteId: string | null;
  notePath: string | null;
};
export type BoardEdge = { id: string; source: string; target: string };
export type Board = { version: number; revision: number; items: BoardItem[]; edges: BoardEdge[] };
export const emptyBoard = (): Board => ({ version: 3, revision: 0, items: [], edges: [] });
export function removeItem(board: Board, id: string): Board {
  return {
    ...board,
    items: board.items
      .filter((i) => i.id !== id)
      .map((i) => (i.parentId === id ? { ...i, parentId: null } : i)),
    edges: board.edges.filter((e) => e.source !== id && e.target !== id),
  };
}
export function connect(board: Board, source: string, target: string): Board {
  if (
    source === target ||
    board.edges.some((e) => e.source === source && e.target === target) ||
    ![source, target].every((id) => board.items.some((i) => i.id === id && i.kind === 'card'))
  )
    return board;
  return { ...board, edges: [...board.edges, { id: crypto.randomUUID(), source, target }] };
}

/** The persisted array is the layer order within each kind. Areas never enter the card band. */
export function reorderItem(board: Board, id: string, direction: 'front' | 'back'): Board {
  const item = board.items.find((entry) => entry.id === id);
  if (!item) return board;
  const sameLayer = (entry: BoardItem) => (entry.kind === 'area') === (item.kind === 'area');
  const peers = board.items.filter((entry) => sameLayer(entry) && entry.id !== id);
  const ordered = direction === 'front' ? [...peers, item] : [item, ...peers];
  let index = 0;
  return {
    ...board,
    items: board.items.map((entry) => (sameLayer(entry) ? ordered[index++] : entry)),
  };
}
export function itemLayer(item: BoardItem, index: number) {
  return item.kind === 'area' ? -20001 + index : 1 + index;
}
export function progressColor(progress: number) {
  return progress >= 100
    ? '#56a782'
    : progress >= 50
      ? '#629bd5'
      : progress > 0
        ? '#d99847'
        : '#929aa4';
}
export function editingSize(item: BoardItem) {
  return item;
}
