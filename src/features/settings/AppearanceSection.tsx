import { useState } from 'react';
import {
  ALargeSmall,
  Code,
  Contrast,
  Languages,
  Palette,
  SunMoon,
  Sparkles,
  Type,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ambientEnabled, setAmbientEnabled } from '../../components/Shell/Shell';
import { Input, Select } from '../../components/ui';
import {
  CONTRAST,
  DEFAULT_APPEARANCE,
  FONT_SIZE,
  LANGUAGES,
  readAppearance,
  resolveLanguage,
  saveAppearance,
  type Appearance,
  type Language,
} from '../../lib/appearance';
import { commands } from '../../lib/bindings';
import { getThemePreference, setThemePreference, type ThemePreference } from '../../lib/theme';
import { AccentPicker, AccentDetails, SliderControl } from './AppearanceControls';
import { Segmented, SettingsCard, SettingsRow, SettingsSection, Switch } from './controls';

/** The backend's locale: tray and notifications take it at the next start. */
async function saveNativeLocale(locale: string) {
  try {
    const config = await commands.getConfig();
    if (config.status === 'ok') await commands.updateConfig({ ...config.data, locale });
  } catch {
    /* The window already changed; only native text waits for the OS default. */
  }
}

const LANGUAGE_LABEL: Record<Language, string> = {
  auto: 'language.auto',
  'pt-BR': 'language.ptBR',
  en: 'language.en',
};

/** Aparência: T3 Code's visual settings, applied live to the whole window (spec 0125). */
export function AppearanceSection({ onLocale }: { onLocale?: (locale: string) => void }) {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<ThemePreference>(() => getThemePreference());
  const [ambient, setAmbient] = useState(() => ambientEnabled());
  const [look, setLook] = useState<Appearance>(() => readAppearance());
  const [announcement, setAnnouncement] = useState('');
  const s = (key: string, options?: Record<string, unknown>) =>
    t(`people.settings.${key}`, options as never) as unknown as string;
  const change = (next: Partial<Appearance>) => setLook(saveAppearance(next));
  const changeLanguage = (language: Language) => {
    change({ language });
    void i18n.changeLanguage(resolveLanguage(language));
    const locale = language === 'auto' ? '' : language;
    onLocale?.(locale);
    void saveNativeLocale(locale);
    setAnnouncement(s('language.changed', { language: s(LANGUAGE_LABEL[language]) }));
  };
  return (
    <SettingsSection
      id="appearance"
      headingId="appearance-heading"
      title={s('sections.appearance')}
      description={s('descriptions.appearance')}
    >
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <SettingsCard>
        <SettingsRow
          name="theme"
          icon={SunMoon}
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
          name="accent"
          icon={Palette}
          title={s('accent.title')}
          description={s('accent.hint')}
          control={<AccentPicker look={look} onChange={change} onAnnounce={setAnnouncement} />}
          below={<AccentDetails look={look} onChange={change} />}
        />
        <SettingsRow
          name="contrast"
          icon={Contrast}
          title={s('contrast.title')}
          description={s('contrast.hint')}
          control={
            <SliderControl
              name="contrast"
              {...CONTRAST}
              value={look.contrast}
              fallback={DEFAULT_APPEARANCE.contrast}
              format={(value) => `${value}%`}
              resetLabel={s('contrast.reset')}
              onChange={(contrast) => change({ contrast })}
              onReset={() => setAnnouncement(s('contrast.wasReset'))}
            />
          }
        />
        <SettingsRow
          name="fontSize"
          icon={ALargeSmall}
          title={s('fontSize.title')}
          description={s('fontSize.hint')}
          control={
            <SliderControl
              name="fontSize"
              min={FONT_SIZE.min}
              max={FONT_SIZE.max}
              step={1}
              value={look.fontSize}
              fallback={DEFAULT_APPEARANCE.fontSize}
              format={(value) => `${value} px`}
              resetLabel={s('fontSize.reset')}
              onChange={(fontSize) => change({ fontSize })}
              onReset={() => setAnnouncement(s('fontSize.wasReset'))}
            />
          }
        />
        <SettingsRow
          name="fontSans"
          icon={Type}
          title={s('fontSans.title')}
          description={s('fontSans.hint')}
          control={
            <Input
              size="sm"
              className="w-full"
              aria-labelledby="fontSans-title"
              aria-describedby="fontSans-desc"
              placeholder={s('fontFamilyDefault')}
              spellCheck={false}
              value={look.fontFamilySans}
              onChange={(event) => change({ fontFamilySans: event.target.value })}
            />
          }
        />
        <SettingsRow
          name="fontMono"
          icon={Code}
          title={s('fontMono.title')}
          description={s('fontMono.hint')}
          control={
            <Input
              size="sm"
              className="w-full"
              aria-labelledby="fontMono-title"
              aria-describedby="fontMono-desc"
              placeholder={s('fontFamilyDefault')}
              spellCheck={false}
              value={look.fontFamilyMono}
              onChange={(event) => change({ fontFamilyMono: event.target.value })}
            />
          }
        />
        <SettingsRow
          name="language"
          icon={Languages}
          title={s('language.title')}
          description={s('language.hint')}
          control={
            <Select
              size="sm"
              block
              aria-labelledby="language-title"
              aria-describedby="language-desc"
              value={look.language}
              onChange={(event) => changeLanguage(event.target.value as Language)}
            >
              {LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {s(LANGUAGE_LABEL[language])}
                </option>
              ))}
            </Select>
          }
        />
        <SettingsRow
          name="ambient"
          icon={Sparkles}
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
