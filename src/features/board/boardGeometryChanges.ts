import type { NodeChange } from '@xyflow/react';
import type { Board } from './model';
import { removeItem } from './model';
import { fitAreas, patchItem } from './hierarchy';

/** Resize position changes adjust the area rectangle, not its children's positions. */
export function boardGeometryChanges(
  current: Board,
  changes: NodeChange[],
  measured: Map<string, { width: number; height: number }>,
  editingId?: string,
  resized = new Set<string>()
): Board {
  let next = current,
    fit = false;
  const resizing = new Set(
    changes.flatMap((c) => (c.type === 'dimensions' && c.resizing ? [c.id] : []))
  );
  for (const change of changes) {
    if (change.type === 'position' && change.position) {
      const values = {
        x: Math.max(-1_000_000, Math.min(1_000_000, change.position.x)),
        y: Math.max(-1_000_000, Math.min(1_000_000, change.position.y)),
      };
      if (resizing.has(change.id)) {
        next = {
          ...next,
          items: next.items.map((i) => (i.id === change.id ? { ...i, ...values } : i)),
        };
        fit = true;
      } else next = patchItem(next, change.id, values, change.dragging === undefined);
    }
    if (change.type === 'dimensions' && change.dimensions) {
      measured.set(change.id, change.dimensions);
      if (change.resizing) resized.add(change.id);
      if (!change.resizing && editingId !== change.id && !resized.has(change.id)) continue;
      const item = next.items.find((i) => i.id === change.id);
      if (
        item &&
        (Math.abs(item.height - change.dimensions.height) > 1 ||
          Math.abs(item.width - change.dimensions.width) > 1)
      ) {
        next = patchItem(
          next,
          change.id,
          {
            width: Math.max(100, change.dimensions.width),
            height: Math.max(60, change.dimensions.height),
          },
          false
        );
        fit = true;
      }
    }
    if (change.type === 'remove') next = removeItem(next, change.id);
  }
  return fit ? fitAreas(next) : next;
}
