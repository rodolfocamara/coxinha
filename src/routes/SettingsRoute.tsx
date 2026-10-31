import { useLocation, useNavigate } from '@tanstack/react-router';
import { SettingsView } from '../features/settings/SettingsView';

/** `/settings` and `/settings#<section>` inside the persistent Shell's main view. */
export function SettingsRoute() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  return (
    <SettingsView
      initialSection={hash || undefined}
      onOpenAgenda={() => void navigate({ to: '/meetings' })}
    />
  );
}
