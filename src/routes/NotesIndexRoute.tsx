import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/AppShell';
import { ActivityBoard } from '../features/board/ActivityBoard';
import '../features/board/locale';
export function NotesIndexRoute() {
  const { t } = useTranslation('board');
  return (
    <AppShell tabs={[{ id: 'board', label: t('title'), active: true }]}>
      <ActivityBoard />
    </AppShell>
  );
}
