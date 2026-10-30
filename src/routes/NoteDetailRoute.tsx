import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, type ErrorComponentProps, useParams, useRouter } from '@tanstack/react-router';
import { queryOptions, useQuery } from '@tanstack/react-query';

import { AppShell } from '../components/AppShell';
import { commands, type NoteContent } from '../lib/bindings';
import { NoteEditor, NoteLoadingSkeleton } from '../features/notes/NoteEditor';
import { noteFileRecoveryKey } from '../lib/noteFileErrors';
import { NoteFileSettingsLink } from '../features/notes/NoteFileSettingsLink';
import { NoteFileDiagnosticDetail } from '../features/notes/NoteFileDiagnosticDetail';

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

export function NoteDetailRoute() {
  const { noteId } = useParams({ from: '/notes/$noteId' });
  return (
    <Suspense fallback={<NoteLoadingSkeleton />}>
      <NoteDetailInner noteId={noteId} />
    </Suspense>
  );
}

function NoteDetailInner({ noteId }: { noteId: string }) {
  const { t } = useTranslation();
  const { data } = useQuery(noteContentQueryOptions(noteId));
  if (!data) {
    return <NoteLoadingSkeleton />;
  }
  const title = data.note.title || t('sidebar.untitled');
  return (
    <AppShell
      trail={[t('nav.notes').toLowerCase(), `${title}.md`]}
      tabs={[{ id: `note-${noteId}`, label: `${title}.md`, active: true }]}
    >
      <NoteEditor noteId={noteId} content={data} />
    </AppShell>
  );
}

export function NoteDetailError({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const guidance = noteFileRecoveryKey(error);
  return (
    <AppShell trail={[t('nav.notes').toLowerCase()]}>
      <section className="p-8 space-y-4">
        <h1>{t('noteError.title')}</h1>
        <p role="alert">{t(guidance ?? 'noteError.description')}</p>
        {guidance ? (
          <NoteFileDiagnosticDetail error={error} />
        ) : (
          <p className="text-sm break-words">{error.message}</p>
        )}
        <div className="flex gap-4">
          <Link to="/meetings">{t('noteError.meetings')}</Link>
          <Link to="/notes">{t('noteError.notes')}</Link>
          {guidance && <NoteFileSettingsLink />}
          <button type="button" onClick={() => void router.invalidate().then(reset)}>
            {t('noteError.retry')}
          </button>
        </div>
      </section>
    </AppShell>
  );
}
