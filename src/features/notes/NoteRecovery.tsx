import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { noteFileRecoveryKey } from '../../lib/noteFileErrors';
import { NoteFileSettingsLink } from './NoteFileSettingsLink';
import { NoteFileDiagnosticDetail } from './NoteFileDiagnosticDetail';
export type RetainedNote = { kind: 'markdown'; markdown: string } | { kind: 'unavailable' };
/** Retained text is never replaced with older durable content after a failed write. */
export function NoteRecovery({
  snapshot,
  retry,
  error,
}: {
  snapshot: RetainedNote;
  retry: () => void;
  error?: unknown;
}) {
  const { t } = useTranslation();
  const failureKey = noteFileRecoveryKey(error);
  const conflict = failureKey !== null && failureKey !== 'noteRecovery.missingOrMoved';
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  async function copy() {
    if (snapshot.kind !== 'markdown') return;
    try {
      await navigator.clipboard.writeText(snapshot.markdown);
    } catch {
      setCopyFailed(true);
      textarea.current?.focus();
      textarea.current?.select();
    }
  }
  return (
    <section className="p-6 space-y-4" aria-label={t('noteRecovery.title')}>
      <h1 className="text-xl font-semibold">{t('noteRecovery.title')}</h1>
      <p role="alert">
        {t(
          failureKey ??
            (snapshot.kind === 'markdown' ? 'noteRecovery.retained' : 'noteRecovery.unavailable')
        )}
      </p>
      {failureKey && <NoteFileDiagnosticDetail error={error} />}
      {failureKey && (
        <p>
          {t(
            snapshot.kind === 'markdown'
              ? conflict
                ? 'noteRecovery.retainedConflict'
                : 'noteRecovery.retained'
              : 'noteRecovery.unavailable'
          )}
        </p>
      )}
      {snapshot.kind === 'markdown' && (
        <>
          <textarea
            ref={textarea}
            readOnly
            aria-label={t('noteRecovery.markdown')}
            value={snapshot.markdown}
            className="w-full min-h-64 border border-border bg-background p-3 font-mono"
          />
          <button
            type="button"
            className="mr-3 rounded border border-border px-3 py-2 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => void copy()}
          >
            {t('noteRecovery.copy')}
          </button>
          {copyFailed && <p role="status">{t('noteRecovery.manualCopy')}</p>}
        </>
      )}
      {failureKey && <NoteFileSettingsLink />}
      <button
        type="button"
        className="rounded border border-border px-3 py-2 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        onClick={retry}
      >
        {t(conflict ? 'noteRecovery.retryAfterReconcile' : 'noteRecovery.retry')}
      </button>
    </section>
  );
}
