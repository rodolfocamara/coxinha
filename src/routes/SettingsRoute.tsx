import { useLocation, useNavigate, useParams } from '@tanstack/react-router';
import { SettingsView } from '../features/settings/SettingsView';
import { settingsLocation, type SettingsSectionId } from '../features/settings/settingsIndex';

/** `/settings/$section#<row>` inside the persistent Shell's main view (spec 0129). */
export function SettingsRoute() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const { section } = useParams({ strict: false }) as { section?: SettingsSectionId };
  return (
    <SettingsView
      section={section}
      target={hash || undefined}
      onNavigate={(next, target) => void navigate(settingsLocation(target ?? next))}
      onOpenAgenda={() => void navigate({ to: '/meetings' })}
    />
  );
}
