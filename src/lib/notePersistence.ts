import type { QueryClient } from '@tanstack/react-query';
import { useAppStore } from './store';

/** Refresh the loader cache only after the Markdown write is acknowledged. */
export async function persistNote(queryClient: QueryClient, noteId: string, markdown: string) {
  await useAppStore.getState().saveNote(noteId, markdown);
  const note = useAppStore.getState().notes.find((item) => item.id === noteId);
  if (note) queryClient.setQueryData(['note', noteId], { note, markdown });
}
