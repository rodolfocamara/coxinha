import { useTranslation } from 'react-i18next';
import { OutlookConnectionCard } from '../agenda/OutlookConnectionCard';
import { useOutlookConnection } from '../agenda/useOutlookConnection';
import { SettingsSection } from './controls';

/** External accounts. Mounting reads only local caches; nothing connects implicitly. */
export function IntegrationsSection({ onOpenAgenda }: { onOpenAgenda?: () => void }) {
  const { t } = useTranslation();
  const outlook = useOutlookConnection();
  return (
    <SettingsSection
      id="integrations"
      headingId="integrations-heading"
      title={t('people.settings.sections.integrations')}
      description={t('people.settings.descriptions.integrations')}
    >
      <OutlookConnectionCard
        connection={outlook}
        onOpenAgenda={onOpenAgenda}
        titleId="integrations-outlook-heading"
      />
    </SettingsSection>
  );
}
