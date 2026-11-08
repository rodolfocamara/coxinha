import { useEffect, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { NoteContent } from '../../lib/bindings';
import { persistNote } from '../../lib/notePersistence';
import { noteFileRecoveryKey } from '../../lib/noteFileErrors';
import { readRetainedNoteSnapshot, waitForNotePersistence } from '../../lib/noteSessions';
import type { RetainedNote } from './NoteRecovery';

/** Pending writes own the current text; a stale loader must not replace it on remount. */
export function useNoteRecovery(noteId: string, content: NoteContent, queryClient: QueryClient) {
  const [resolved, setResolved] = useState<{ id: string; content: NoteContent } | null>(null);
  const [recovery, setRecovery] = useState<{
    id: string;
    snapshot: RetainedNote;
    error: unknown;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const queryClientRef = useRef(queryClient);
  const fallbackRef = useRef(content);
  fallbackRef.current = content;
  useEffect(() => {
    let live = true;
    setRecovery(null);
    void waitForNotePersistence(noteId)
      .then(() => {
        if (!live) return;
        const latest = queryClientRef.current.getQueryData<NoteContent>(['note', noteId]);
        setResolved({ id: noteId, content: latest ?? fallbackRef.current });
      })
      .catch(async (error: unknown) => {
        const snapshot = await readRetainedNoteSnapshot(noteId);
        if (live) setRecovery({ id: noteId, snapshot, error });
      });
    return () => {
      live = false;
    };
  }, [noteId, attempt]);

  async function save(markdown: string) {
    try {
      await persistNote(queryClient, noteId, markdown);
    } catch (error) {
      if (noteFileRecoveryKey(error)) {
        const snapshot = await readRetainedNoteSnapshot(noteId);
        setRecovery({ id: noteId, snapshot, error });
      }
      throw error;
    }
  }

  return {
    ready: resolved?.id === noteId ? resolved.content : null,
    recovery: recovery?.id === noteId ? recovery : null,
    retry() {
      setResolved(null);
      setAttempt((value) => value + 1);
    },
    save,
  };
}
