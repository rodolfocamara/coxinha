import { useEffect, useRef, useState } from 'react';
import { boardSession } from '../board/persistence';
import type { Board, BoardItem } from '../board/model';

const UNDO_MS = 8000;

/** Fields keep Delete and Backspace for their text. */
function typing(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
  );
}

/**
 * Delete or Backspace takes the selected item off the board, as in
 * Excalidraw (spec 0112 P3). The note itself stays; the board before the
 * removal is kept for one undo (button or Ctrl+Z).
 */
export function useRemoveShortcut({
  selected,
  remove,
  title,
}: {
  selected: BoardItem | null;
  remove: (id: string) => void;
  title: (item: BoardItem) => string;
}) {
  const [removed, setRemoved] = useState<{ board: Board; title: string } | null>(null);
  const latest = useRef({ selected, remove, title, removed });
  latest.current = { selected, remove, title, removed };

  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [removed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || typing(event.target)) return;
      const { selected, remove, title, removed } = latest.current;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && removed) {
        event.preventDefault();
        undo();
        return;
      }
      if ((event.key !== 'Delete' && event.key !== 'Backspace') || !selected) return;
      const board = boardSession.get();
      if (!board) return;
      event.preventDefault();
      setRemoved({ board, title: title(selected) });
      remove(selected.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function undo() {
    const snapshot = latest.current.removed;
    if (!snapshot) return;
    const current = boardSession.get();
    // Keep what changed since (moves, new items) and bring back what was removed,
    // with an area's children back inside it.
    const restored = current ? restore(current, snapshot.board) : snapshot.board;
    boardSession.update(restored);
    setRemoved(null);
  }

  return { removed: removed?.title ?? null, undo, dismiss: () => setRemoved(null) };
}

export function restore(current: Board, before: Board): Board {
  const now = new Set(current.items.map((i) => i.id));
  const gone = new Set(before.items.filter((i) => !now.has(i.id)).map((i) => i.id));
  const parentBefore = new Map(before.items.map((i) => [i.id, i.parentId ?? null]));
  const items = current.items.map((i) => {
    const parent = parentBefore.get(i.id);
    return parent && gone.has(parent) && !i.parentId ? { ...i, parentId: parent } : i;
  });
  const back = before.items.filter((i) => gone.has(i.id));
  const edges = [
    ...current.edges,
    ...before.edges.filter(
      (e) =>
        !current.edges.some((o) => o.id === e.id) &&
        (gone.has(e.source) || gone.has(e.target)) &&
        (now.has(e.source) || gone.has(e.source)) &&
        (now.has(e.target) || gone.has(e.target))
    ),
  ];
  // Areas sit under their children: restored areas go first so they stay behind.
  return { ...current, items: [...back, ...items], edges };
}
