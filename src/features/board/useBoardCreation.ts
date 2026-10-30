import { useRef, useState } from 'react';
import type { Note } from '../../lib/bindings';
import { registerSaveParticipant } from '../../lib/lifecycle';
import type { EditorFocusRequest } from '../notes/editorFocusRequest';
import { boardSession } from './persistence';
import type { BoardItem } from './model';

const creations = new Set<Promise<void>>();
registerSaveParticipant(async () => {
  await Promise.all([...creations]);
});
export function useBoardCreation({
  notes,
  newNote,
  begin,
  open,
  position,
}: {
  notes: Note[];
  newNote: () => Promise<Note>;
  begin: () => EditorFocusRequest;
  open: (item: BoardItem, request: EditorFocusRequest) => void;
  position: (width: number, height: number) => { x: number; y: number };
}) {
  const [pending, setPending] = useState<{
    item: BoardItem;
    failed: boolean;
    sourceId?: string;
  } | null>(null);
  const busy = useRef(false);
  async function create(
    id?: string,
    retryItem?: BoardItem,
    kind: 'card' | 'text' = 'card',
    point?: { x: number; y: number }
  ) {
    if (busy.current || !boardSession.get()) return;
    busy.current = true;
    const request = begin();
    const item: BoardItem = retryItem ?? {
      id: crypto.randomUUID(),
      kind,
      ...(point ?? position(340, 180)),
      width: 340,
      height: 180,
      color: 'neutral',
      label: '',
      noteId: null,
      notePath: null,
      progress: 0,
    };
    setPending({ item, failed: false, sourceId: id });
    const work = (async () => {
      try {
        const note = id ? notes.find((entry) => entry.id === id) : await newNote();
        if (!note) throw new Error('Note unavailable');
        const attached = { ...item, noteId: note.id, notePath: note.path };
        const current = boardSession.get()!;
        boardSession.update({ ...current, items: [...current.items, attached] });
        setPending(null);
        open(attached, request);
        // The session retains failed board writes and exposes retry/recovery.
        await boardSession.flush().catch(() => {});
      } catch {
        request.cancel();
        setPending({ item, failed: true, sourceId: id });
      } finally {
        busy.current = false;
      }
    })();
    creations.add(work);
    try {
      await work;
    } finally {
      creations.delete(work);
    }
  }
  return {
    pending,
    create,
    createText: (point?: { x: number; y: number }) => create(undefined, undefined, 'text', point),
    retry: () => void create(pending?.sourceId, pending?.item),
    dismiss: () => setPending(null),
  };
}
