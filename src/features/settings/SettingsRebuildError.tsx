import { useTranslation } from 'react-i18next';
import { noteFileRebuildKey } from '../../lib/noteFileErrors';
import { NoteFileDiagnosticDetail } from '../notes/NoteFileDiagnosticDetail';
import { Alert } from '../../components/ui';

export function SettingsRebuildError({ message }: { message: string }) {
  const { t } = useTranslation();
  const guidance = noteFileRebuildKey(message);
  return (
    <Alert tone="error" className="w-full">
      <p>{guidance ? t(guidance) : t('settings.vault.rebuildError', { error: message })}</p>
      {guidance && <NoteFileDiagnosticDetail error={message} />}
    </Alert>
  );
}
