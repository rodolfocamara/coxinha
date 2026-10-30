import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Palette, Folder, Keyboard, Wrench, Info, Mic, Plug } from 'lucide-react';
import './settings.css';

export function SettingsFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const sections = [
    ['appearance-heading', 'settings.appearance.heading', Palette],
    ['detection-heading', 'meetingDetection.settings', Mic],
    ['integrations-heading', 'settings.integrations.heading', Plug],
    ['vault-heading', 'settings.vault.heading', Folder],
    ['shortcuts-heading', 'settings.shortcuts.heading', Keyboard],
    ['rebuild-heading', 'settings.vault.rebuildHeading', Wrench],
    ['diagnostics-heading', 'settings.recovery.diagnostics', Info],
  ] as const;
  return (
    <section className="settings-page" aria-labelledby="settings-heading">
      <header>
        <h1 id="settings-heading">{t('settings.title')}</h1>
        <p>{t('settings.layout.description')}</p>
      </header>
      <div className="settings-layout">
        <nav aria-label={t('settings.layout.sections')} className="settings-navigation">
          {sections.map(([id, label, Icon]) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={() => {
                const heading = document.getElementById(id);
                if (heading) {
                  heading.tabIndex = -1;
                  heading.focus({ preventScroll: true });
                }
              }}
            >
              <Icon size={16} aria-hidden="true" />
              {t(label)}
            </a>
          ))}
        </nav>
        <div className="settings-content">{children}</div>
      </div>
    </section>
  );
}
