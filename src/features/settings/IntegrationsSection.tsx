import { useTranslation } from 'react-i18next';
import { OutlookConnectionCard } from '../agenda/OutlookConnectionCard';
import { useOutlookConnection } from '../agenda/useOutlookConnection';
import { SettingsSection } from './controls';
import { sectionHeadingId } from './settingsIndex';
import { TitleLlmSettings } from '../live/TitleLlmSettings';

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

/** Títulos e resumos: the other thing that sends data off the computer (spec 0129 P2). */
export function TitlesSection() {
  const { t } = useTranslation();
  return (
    <SettingsSection
      id="titles"
      headingId={sectionHeadingId('titles')}
      title={t('people.settings.sections.titles')}
      description={t('people.settings.descriptions.titles')}
    >
      <TitleLlmSettings />
    </SettingsSection>
  );
}
