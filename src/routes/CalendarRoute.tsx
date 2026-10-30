import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/AppShell';
import { CalendarView } from '../features/sessions/CalendarView';

export function CalendarRoute() {
  const { t } = useTranslation();
  return (
    <AppShell trail={[t('sessionCalendar.title')]}>
      <CalendarView />
    </AppShell>
  );
}
