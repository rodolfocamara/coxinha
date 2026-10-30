import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { commands } from '../../lib/bindings';
import { waitForNotePersistence } from '../../lib/noteSessions';
import { useAppStore } from '../../lib/store';
import { NoteEditor, NoteLoadingSkeleton } from '../notes/NoteEditor';
import { NoteFileDiagnosticDetail } from '../notes/NoteFileDiagnosticDetail';
import { NoteFileSettingsLink } from '../notes/NoteFileSettingsLink';
import { sessions } from './sessions';
export function SessionNotes({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['session-note', sessionId],
    queryFn: async () => {
      const session = await sessions.ensureNote(sessionId);
      if (!session.personal_note) throw new Error('session_note_missing');
      const id = session.personal_note.id;
      await waitForNotePersistence(id).catch(() => {});
      const result = await commands.getNote(id);
      if (result.status === 'error') throw new Error(result.error);
      client.setQueryData(['note', id], result.data);
      // Make the newly indexed personal note reachable through global search.
      const store = useAppStore.getState();
      useAppStore.setState({
        notes: [...store.notes.filter((n) => n.id !== id), result.data.note],
      });
      return result.data;
    },
    retry: false,
    staleTime: 0,
  });
  if (query.isError)
    return (
      <section className="p-6 space-y-3">
        <p role="alert">{t('session.noteFailed')}</p>
        <NoteFileDiagnosticDetail error={query.error} />
        <NoteFileSettingsLink />
        <button className="border rounded px-3 py-2" onClick={() => void query.refetch()}>
          {t('session.retry')}
        </button>
      </section>
    );
  if (!query.data) return <NoteLoadingSkeleton />;
  return (
    <NoteEditor
      variant="embedded"
      key={query.data.note.id}
      noteId={query.data.note.id}
      content={query.data}
    />
  );
}
