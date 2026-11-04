import type { Board, BoardItem } from './model';
const PAD = 16;
const HEADER = 52;
const bound = (n: number) => Math.max(-1_000_000, Math.min(1_000_000, n));
export function areaProgress(board: Board, id: string) {
  const children = board.items.filter((i) => i.kind === 'card' && i.parentId === id);
  const started = children.some((i) => (i.progress ?? 0) > 0);
  const complete = children.length > 0 && children.every((i) => (i.progress ?? 0) === 100);
  return {
    count: children.length,
    progress: children.length
      ? Math.min(
          complete ? 100 : 99,
          Math.max(
            started ? 1 : 0,
            Math.round(children.reduce((s, i) => s + (i.progress ?? 0), 0) / children.length)
          )
        )
      : null,
  };
}
export function fitAreas(board: Board): Board {
  return {
    ...board,
    items: board.items.map((area) => {
      if (area.kind !== 'area') return area;
      const children = board.items.filter((i) => i.parentId === area.id);
      if (!children.length) return area;
      const x = Math.min(area.x, ...children.map((i) => i.x - PAD));
      const y = Math.min(area.y, ...children.map((i) => i.y - HEADER));
      const right = Math.max(area.x + area.width, ...children.map((i) => i.x + i.width + PAD));
      const bottom = Math.max(area.y + area.height, ...children.map((i) => i.y + i.height + PAD));
      return {
        ...area,
        x: bound(x),
        y: bound(y),
        width: Math.min(1_000_000, right - x),
        height: Math.min(1_000_000, bottom - y),
      };
    }),
  };
}
export function patchItem(board: Board, id: string, values: Partial<BoardItem>, fit = true): Board {
  const item = board.items.find((i) => i.id === id);
  if (!item) return board;
  const dx = (values.x ?? item.x) - item.x,
    dy = (values.y ?? item.y) - item.y;
  const next = {
    ...board,
    items: board.items.map((i) =>
      i.id === id
        ? { ...i, ...values }
        : item.kind === 'area' && i.parentId === id
          ? { ...i, x: bound(i.x + dx), y: bound(i.y + dy) }
          : i
    ),
  };
  return fit ? fitAreas(next) : next;
}
export function dropArea(board: Board, item: BoardItem): BoardItem | undefined {
  if (item.kind === 'area') return;
  const x = item.x + item.width / 2,
    y = item.y + item.height / 2;
  return [...board.items]
    .reverse()
    .find(
      (a) =>
        a.kind === 'area' &&
        x >= a.x &&
        x <= a.x + a.width &&
        y >= a.y + HEADER &&
        y <= a.y + a.height
    );
}
export function assignArea(board: Board, id: string, parentId: string | null): Board {
  const item = board.items.find((i) => i.id === id);
  const parent = board.items.find((i) => i.id === parentId && i.kind === 'area');
  if (!item || item.kind === 'area' || (parentId && !parent)) return board;
  return patchItem(board, id, {
    parentId,
    ...(parent
      ? { x: Math.max(parent.x + PAD, item.x), y: Math.max(parent.y + HEADER, item.y) }
      : {}),
  });
}
