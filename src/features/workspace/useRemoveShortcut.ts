import { useEffect, useRef, useState } from 'react';
import { useShortcut } from '../../lib/shortcuts';
import { useAppStore } from '../../lib/store';
import { TRASH_UNDO_MS } from '../notes/trashUndo';
import { boardSession } from '../board/persistence';
import type { Board, BoardItem } from '../board/model';

type Removed = { board: Board; title: string; noteId: string | null };

/**
 * Delete or Backspace removes the selected item, as in Excalidraw (spec 0112
 * P3). An activity or note goes with its note file to `.coxinha/trash/`; an
 * area only leaves the board. Undo (button or Mod+Z) restores both.
 */
export function useRemoveShortcut({
  selected,
  remove,
  removeNote,
  title,
  onError,
}: {
  selected: BoardItem | null;
  /** Takes the item, and every card of its note, off the board and closes the editor. */
  remove: (item: BoardItem) => void;
  /** The same for a note the side editor shows, on the board or not. */
  removeNote: (noteId: string) => void;
  title: (item: BoardItem) => string;
  onError: (error: unknown) => void;
}) {
  const deleteNote = useAppStore((s) => s.deleteNote);
  const restoreNote = useAppStore((s) => s.restoreNote);
  const [removed, setRemoved] = useState<Removed | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), TRASH_UNDO_MS);
    return () => clearTimeout(timer);
  }, [removed]);

  async function take(what: { title: string; noteId: string | null; remove: () => void }) {
    const board = boardSession.get();
    if (!board || busy.current) return;
    busy.current = true;
    what.remove();
    try {
      if (what.noteId) await deleteNote(what.noteId);
      setRemoved({ board, title: what.title, noteId: what.noteId });
    } catch (error) {
      // The note stays (a meeting's own note, a file in use): so does its card.
      const current = boardSession.get();
      if (current) boardSession.update(restore(current, board));
      onError(error);
    } finally {
      busy.current = false;
    }
  }

  async function undo() {
    if (!removed || busy.current) return;
    const snapshot = removed;
    busy.current = true;
    setRemoved(null);
    try {
      const note = snapshot.noteId ? await restoreNote(snapshot.noteId) : null;
      const current = boardSession.get();
      // Keep what changed since (moves, new items) and bring back what was removed.
      const back = current ? restore(current, snapshot.board) : snapshot.board;
      boardSession.update(
        note
          ? {
              ...back,
              items: back.items.map((i) =>
                i.noteId === note.id ? { ...i, notePath: note.path } : i
              ),
            }
          : back
      );
    } catch (error) {
      onError(error);
    } finally {
      busy.current = false;
    }
  }

  useShortcut('board.undo', () => void undo(), { enabled: !!removed });
  useShortcut(
    'board.remove',
    () => {
      if (!selected) return;
      void take({
        title: title(selected),
        noteId: selected.kind === 'area' ? null : selected.noteId,
        remove: () => remove(selected),
      });
    },
    { enabled: !!selected }
  );

  return {
    removed: removed ? { title: removed.title, trashed: !!removed.noteId } : null,
    undo: () => void undo(),
    trashNote: (noteId: string, noteTitle: string) =>
      take({ title: noteTitle, noteId, remove: () => removeNote(noteId) }),
  };
}

/** `before` with the items and links that `current` lost, an area's children back inside. */
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
  // Restored areas go first so they stay behind the cards.
  return { ...current, items: [...back, ...items], edges };
}
