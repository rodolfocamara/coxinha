import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { AppShell } from '../components/AppShell';
import { AgendaPanel } from '../features/agenda/AgendaPanel';
import { AgendaView } from '../features/agenda/AgendaView';

export function AgendaRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <AppShell
      trail={[t('nav.agenda').toLowerCase()]}
      tabs={[{ id: 'agenda', label: t('nav.agenda'), active: true }]}
      sidePanel={<AgendaPanel />}
    >
      <AgendaView
        onConfigure={() => void navigate({ to: '/settings', hash: 'integrations-heading' })}
      />
    </AppShell>
  );
}
