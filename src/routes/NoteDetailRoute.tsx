import { useTranslation } from 'react-i18next';
import { type ErrorComponentProps, useNavigate, useRouter } from '@tanstack/react-router';
import { Button } from '../components/ui';
import { noteFileRecoveryKey } from '../lib/noteFileErrors';
import { NoteFileSettingsLink } from '../features/notes/NoteFileSettingsLink';
import { NoteFileDiagnosticDetail } from '../features/notes/NoteFileDiagnosticDetail';

// `/workspace/$noteId` renders the Workspace (side editor); the router still
// preloads the note through these options and shows `NoteDetailError` when
// the file cannot be read.
export { noteContentQueryOptions } from '../features/notes/noteQuery';

export function NoteDetailError({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const navigate = useNavigate();
  const guidance = noteFileRecoveryKey(error);
  return (
    <section className="p-8 space-y-4 max-w-[640px]">
      <h1 className="text-lg font-semibold">{t('noteError.title')}</h1>
      <p role="alert">{t(guidance ?? 'noteError.description')}</p>
      {guidance ? (
        <NoteFileDiagnosticDetail error={error} />
      ) : (
        <p className="text-sm break-words text-muted-foreground">{error.message}</p>
      )}
      {guidance && <NoteFileSettingsLink />}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => void router.invalidate().then(reset)}>
          {t('noteError.retry')}
        </Button>
        <Button size="sm" onClick={() => void navigate({ to: '/workspace' })}>
          {t('noteError.notes')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void navigate({ to: '/meetings' })}>
          {t('noteError.meetings')}
        </Button>
      </div>
    </section>
  );
}
