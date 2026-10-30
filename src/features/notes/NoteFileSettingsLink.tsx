import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

/** Navigation only. Rebuild remains an explicit action in the existing Settings section. */
export function NoteFileSettingsLink() {
  const { t } = useTranslation();
  return (
    <Link to="/settings" hash="rebuild-heading" className="block underline">
      {t('noteRecovery.openRebuildSettings')}
    </Link>
  );
}
