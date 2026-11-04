import { queryOptions } from '@tanstack/react-query';
import { commands, type NoteContent } from '../../lib/bindings';

/** Note content cache shared by the Workspace editor, canvas cards and routes. */
export function noteContentQueryOptions(noteId: string) {
  return queryOptions({
    queryKey: ['note', noteId] as const,
    queryFn: async (): Promise<NoteContent> => {
      const r = await commands.getNote(noteId);
      if (r.status === 'error') throw new Error(r.error);
      return r.data;
    },
    // Keep cached content fresh until a save invalidates it.
    staleTime: Infinity,
  });
}
