import type { RefObject } from 'react';
import type { Node } from '@xyflow/react';
import { boardSession } from './persistence';
import { assignArea, dropArea, patchItem } from './hierarchy';
export function boardDrag(
  measured: RefObject<Map<string, { width: number; height: number }>>,
  target: (id: string | null) => void
) {
  return {
    move(_: unknown, node: Node) {
      const current = boardSession.get();
      const item = current?.items.find((i) => i.id === node.id);
      target(
        current && item
          ? (dropArea(current, { ...item, ...node.position, ...measured.current.get(item.id) })
              ?.id ?? null)
          : null
      );
    },
    stop(_: unknown, node: Node) {
      const current = boardSession.get();
      const item = current?.items.find((i) => i.id === node.id);
      if (current && item && item.kind !== 'area') {
        const positioned = patchItem(
          current,
          item.id,
          { ...node.position, ...measured.current.get(item.id) },
          false
        );
        const moved = positioned.items.find((i) => i.id === item.id)!;
        boardSession.update(
          assignArea(positioned, item.id, dropArea(positioned, moved)?.id ?? null)
        );
      }
      target(null);
    },
  };
}
