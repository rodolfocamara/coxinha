import type { Board } from './model';
export type ChildBounds = { left: number; top: number; right: number; bottom: number };
export function childBounds(
  board: Board,
  id: string,
  measured: Map<string, { width: number; height: number }>
): ChildBounds | undefined {
  const children = board.items.filter((i) => i.parentId === id);
  if (!children.length) return;
  return {
    left: Math.min(...children.map((i) => i.x - 16)),
    top: Math.min(...children.map((i) => i.y - 52)),
    right: Math.max(...children.map((i) => i.x + (measured.get(i.id)?.width ?? i.width) + 16)),
    bottom: Math.max(...children.map((i) => i.y + (measured.get(i.id)?.height ?? i.height) + 16)),
  };
}
export function containsChildren(
  rect: { x: number; y: number; width: number; height: number },
  bounds?: ChildBounds
) {
  return (
    !bounds ||
    (rect.x <= bounds.left &&
      rect.y <= bounds.top &&
      rect.x + rect.width >= bounds.right &&
      rect.y + rect.height >= bounds.bottom)
  );
}
