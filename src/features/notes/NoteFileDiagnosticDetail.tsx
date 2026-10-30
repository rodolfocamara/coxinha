import { useTranslation } from 'react-i18next';
import { noteFileDiagnosticDetail } from '../../lib/noteFileErrors';

/** Render diagnostics as escaped selectable text, never HTML or note Markdown. */
export function NoteFileDiagnosticDetail({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const detail = noteFileDiagnosticDetail(error);
  return detail ? (
    <pre
      aria-label={t('noteRecovery.diagnosticDetail')}
      className="whitespace-pre-wrap break-words text-sm"
    >
      {detail}
    </pre>
  ) : null;
}
