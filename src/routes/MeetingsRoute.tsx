import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/AppShell';
import { LibraryView } from '../features/meetings/LibraryView';
export function MeetingsRoute() {
  const { t } = useTranslation();
  return (
    <AppShell
      trail={[t('library.title')]}
      tabs={[{ id: 'meetings', label: t('library.title'), active: true }]}
    >
      <LibraryView />
    </AppShell>
  );
}
