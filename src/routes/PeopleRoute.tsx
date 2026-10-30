import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/AppShell';
import { PeopleDirectory } from '../features/meetings/PeopleDirectory';

export function PeopleRoute() {
  const { t } = useTranslation();
  return (
    <AppShell trail={[t('peopleDirectory.title')]}>
      <PeopleDirectory />
    </AppShell>
  );
}
