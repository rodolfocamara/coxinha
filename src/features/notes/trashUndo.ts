import { create } from 'zustand';
import { useAppStore } from '../../lib/store';

export const TRASH_UNDO_MS = 8000;

type Pending = { noteId: string; title: string };

export const useTrashUndo = create<{ pending: Pending | null; failed: boolean }>(() => ({
  pending: null,
  failed: false,
}));

let timer: ReturnType<typeof setTimeout> | undefined;

const clear = () => {
  clearTimeout(timer);
  useTrashUndo.setState({ pending: null });
};

/**
 * The note goes to `.coxinha/trash/` at once and stays recoverable, so there is
 * no question first. `window.confirm` cannot ask one in this app: the dialog
 * plugin replaces it with an async function, whose Promise is always truthy.
 */
export async function moveNoteToTrash(
  note: { id: string; title: string },
  deleteNote: (id: string) => Promise<unknown>
) {
  await deleteNote(note.id);
  clearTimeout(timer);
  useTrashUndo.setState({ pending: { noteId: note.id, title: note.title }, failed: false });
  timer = setTimeout(clear, TRASH_UNDO_MS);
}

export async function undoTrash() {
  const { pending } = useTrashUndo.getState();
  if (!pending) return;
  clear();
  try {
    await useAppStore.getState().restoreNote(pending.noteId);
  } catch {
    useTrashUndo.setState({ failed: true });
  }
}
