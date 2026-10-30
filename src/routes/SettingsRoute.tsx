import { useLocation, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { AppShell } from '../components/AppShell';
import { SettingsView } from '../features/settings/SettingsView';

export function SettingsRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hash } = useLocation();
  return (
    <AppShell
      trail={[t('nav.settings').toLowerCase()]}
      tabs={[{ id: 'settings', label: t('nav.settings'), active: true }]}
    >
      {/* The shell canvas clips overflow, so the page owns its scroll. */}
      <div className="h-full overflow-auto" data-testid="settings-scroll">
        <SettingsView
          initialSection={hash || undefined}
          onOpenAgenda={() => void navigate({ to: '/agenda' })}
        />
      </div>
    </AppShell>
  );
}
