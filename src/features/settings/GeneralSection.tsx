import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ambientEnabled, setAmbientEnabled } from '../../components/Shell/Shell';
import { getThemePreference, setThemePreference, type ThemePreference } from '../../lib/theme';
import { Segmented, SettingsCard, SettingsRow, SettingsSection, Switch } from './controls';

/** Geral: theme and the ambient gradient. No language picker yet (owner decision pending). */
export function GeneralSection() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<ThemePreference>(() => getThemePreference());
  const [ambient, setAmbient] = useState(() => ambientEnabled());
  const s = (key: string) => t(`people.settings.${key}`);
  return (
    <SettingsSection
      id="general"
      headingId="appearance-heading"
      title={s('sections.general')}
      description={s('descriptions.general')}
    >
      <SettingsCard>
        <SettingsRow
          name="theme"
          title={s('theme.title')}
          description={s('theme.hint')}
          control={
            <Segmented<ThemePreference>
              name="theme"
              value={theme}
              options={(['auto', 'light', 'dark'] as const).map((value) => ({
                value,
                label: s(`theme.${value}`),
              }))}
              onChange={(next) => {
                setTheme(next);
                setThemePreference(next);
              }}
            />
          }
        />
        <SettingsRow
          name="ambient"
          title={s('ambient.title')}
          description={s('ambient.hint')}
          control={
            <Switch
              name="ambient"
              checked={ambient}
              onChange={(next) => {
                setAmbient(next);
                setAmbientEnabled(next);
              }}
            />
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}
