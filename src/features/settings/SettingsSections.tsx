import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppConfig } from '../../lib/bindings';
import { getThemePreference, setThemePreference, type ThemePreference } from '../../lib/theme';

export function AppearanceSection() {
  const { t } = useTranslation();
  const [pref, setPref] = useState<ThemePreference>(() => getThemePreference());

  function choose(next: ThemePreference) {
    setPref(next);
    setThemePreference(next);
  }

  const options: ThemePreference[] = ['auto', 'light', 'dark'];

  return (
    <fieldset aria-labelledby="appearance-heading" className="space-y-3">
      <legend id="appearance-heading">{t('settings.appearance.heading')}</legend>
      <p className="text-xs text-muted-foreground">{t('settings.appearance.themeHint')}</p>
      {/* Segmented control: neutral selection keeps orange for primary actions (DESIGN.md §2). */}
      <div className="inline-flex gap-0.5 rounded-sm border border-border bg-secondary p-0.5">
        {options.map((opt) => (
          <label
            key={opt}
            className={
              'inline-flex h-8 cursor-pointer items-center rounded-sm px-3 text-ui focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring ' +
              (pref === opt
                ? 'bg-card font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground')
            }
          >
            <input
              type="radio"
              name="theme-pref"
              value={opt}
              checked={pref === opt}
              onChange={() => choose(opt)}
              className="sr-only"
            />
            {t(`settings.appearance.theme.${opt}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// Display order matches the user's mental model (create → navigate
// → record), not the struct field order — lifted to module scope
// so it isn't recreated per render.
const SHORTCUT_KEYS: ReadonlyArray<keyof AppConfig['shortcuts']> = [
  'new_note',
  'open_app',
  'agenda',
  'meetings',
  'toggle_recording',
];

export function ShortcutsSection({ shortcuts }: { shortcuts: AppConfig['shortcuts'] }) {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="shortcuts-heading" className="space-y-3">
      <h2 id="shortcuts-heading">{t('settings.shortcuts.heading')}</h2>
      <p className="text-xs text-muted-foreground">{t('settings.shortcuts.rebindComingSoon')}</p>
      <ul className="space-y-0.5">
        {SHORTCUT_KEYS.map((key) => (
          <li key={key} className="grid grid-cols-[1fr_auto] items-center gap-4 px-2">
            <span className="text-ui">{t(`settings.shortcuts.action.${key}`)}</span>
            <kbd className="cx-kbd">{shortcuts[key]}</kbd>
          </li>
        ))}
      </ul>
    </section>
  );
}
