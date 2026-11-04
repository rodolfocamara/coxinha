import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { settingsLocation } from '../settings/settingsIndex';

/** Navigation only. Rebuild remains an explicit action in the existing Settings section. */
export function NoteFileSettingsLink() {
  const { t } = useTranslation();
  return (
    <Link {...settingsLocation('rebuild')} className="block underline">
      {t('noteRecovery.openRebuildSettings')}
    </Link>
  );
}
