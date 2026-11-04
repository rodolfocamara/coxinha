import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Select } from '../../components/ui';
import { ActiveSettingsPage } from './controls';
import { SECTION_ICONS } from './icons';
import { SettingsFilter } from './SettingsFilter';
import {
  FIRST_SETTINGS_SECTION,
  resolveSettingsHash,
  SETTINGS_GROUPS,
  type SettingsSectionId,
} from './settingsIndex';
import './settingsPages.css';

/** Tauri does not sync the native title with document.title. */
function setWindowTitle(title: string) {
  document.title = title;
  try {
    if (isTauri())
      void getCurrentWindow()
        .setTitle(title)
        .catch(() => {});
  } catch {
    /* Outside the app there is only the document title. */
  }
}

/** Scrolls only its own page (scrollIntoView would also scroll the shell). */
function focusRow(element: HTMLElement, page: HTMLElement) {
  element.tabIndex = -1;
  element.focus({ preventScroll: true });
  const top = element.getBoundingClientRect().top - page.getBoundingClientRect().top;
  page.scrollTop = Math.max(0, page.scrollTop + top - 16);
}

/**
 * Ajustes frame (spec 0129): the sidebar beside one page. Every page stays
 * mounted, so a half-typed field or a running download survives going away;
 * `SettingsSection` hides those not on screen.
 */
export function SettingsLayout({
  children,
  ready,
  section = FIRST_SETTINGS_SECTION,
  target,
  onNavigate,
}: {
  children: ReactNode;
  /** Sections that wait for the config are rendered. */
  ready: boolean;
  section?: SettingsSectionId;
  /** Hash of the row to land on. */
  target?: string;
  onNavigate?: (section: SettingsSectionId, target?: string) => void;
}) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const scrolls = useRef<Partial<Record<SettingsSectionId, number>>>({});
  const picked = useRef(false);
  const brand = t('brand.name');
  const pageTitle = t(`people.settings.sections.${section}`);
  const settingsTitle = t('people.settings.title');
  const rowAnchor = target ? resolveSettingsHash(target)?.target : undefined;

  useEffect(() => {
    setWindowTitle(`${pageTitle} · ${settingsTitle} · ${brand}`);
  }, [pageTitle, settingsTitle, brand]);
  useEffect(() => () => setWindowTitle(brand), [brand]);

  // TanStack's hash scroll (and the browser's) call scrollIntoView, which
  // also scrolls the clipped shell containers. Ancestors of this view never
  // scroll on purpose, so pin them while Ajustes is mounted.
  useEffect(() => {
    const ancestors = new Set<Element>();
    for (let el = root.current?.parentElement; el; el = el.parentElement) ancestors.add(el);
    const pin = (event: Event) => {
      const scrolled = event.target;
      if (scrolled instanceof Element && ancestors.has(scrolled)) scrolled.scrollTo(0, 0);
    };
    document.addEventListener('scroll', pin, true);
    return () => document.removeEventListener('scroll', pin, true);
  }, []);

  const currentPage = () => pages.current?.querySelector<HTMLElement>(`[id="${section}"]`) ?? null;
  const focusTitle = () =>
    currentPage()?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  const landOnRow = (anchor: string) => {
    const page = currentPage();
    const element = document.getElementById(anchor);
    if (!page || !element || !page.contains(element)) return false;
    focusRow(element, page);
    return true;
  };

  // Layout effect: the field losing focus saves on blur before anything repaints.
  useLayoutEffect(() => {
    const page = currentPage();
    if (page) page.scrollTop = scrolls.current[section] ?? 0;
    if (!rowAnchor) {
      focusTitle();
      return;
    }
    if (landOnRow(rowAnchor)) return;
    focusTitle();
    // The row waits for the backend's answer; it takes focus unless the owner moved on.
    const box = pages.current;
    if (!box) return;
    const waiting = new MutationObserver(() => {
      const moved = document.activeElement?.closest('input, select, button, a, textarea');
      if (moved) waiting.disconnect();
      else if (landOnRow(rowAnchor)) waiting.disconnect();
    });
    waiting.observe(box, { childList: true, subtree: true });
    return () => waiting.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, rowAnchor]);

  // A page waiting for the config is replaced when it arrives, and its title with it.
  useLayoutEffect(() => {
    if (ready && document.activeElement === document.body) focusTitle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const go = (next: SettingsSectionId, anchor?: string) => {
    if (next !== section || anchor !== rowAnchor) onNavigate?.(next, anchor);
    else if (anchor) landOnRow(anchor);
    else focusTitle();
  };

  return (
    <ActiveSettingsPage.Provider value={section}>
      <div
        ref={root}
        className="cx-settings text-ui"
        aria-labelledby="settings-heading"
        role="region"
      >
        <div className="cx-settings-frame">
          <div className="cx-settings-side">
            <p id="settings-heading" className="cx-settings-title">
              {settingsTitle}
            </p>
            <SettingsFilter onPick={(entry) => go(entry.section, entry.anchor)}>
              <div className="cx-settings-picker">
                <Select
                  size="sm"
                  block
                  aria-label={t('people.settings.sectionsLabel')}
                  value={section}
                  onChange={(event) => {
                    picked.current = true;
                    go(event.target.value as SettingsSectionId);
                  }}
                  onCloseAutoFocus={(event) => {
                    // The popup hands focus back as it closes; a new page keeps it instead.
                    if (!picked.current) return;
                    picked.current = false;
                    event.preventDefault();
                    focusTitle();
                  }}
                >
                  {SETTINGS_GROUPS.map((group) => (
                    <optgroup key={group.id} label={t(`people.settings.groups.${group.id}`)}>
                      {group.sections.map((id) => (
                        <option key={id} value={id}>
                          {t(`people.settings.sections.${id}`)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </div>
              <nav aria-label={t('people.settings.sectionsLabel')} className="cx-settings-nav">
                {SETTINGS_GROUPS.map((group) => (
                  <div key={group.id} className="cx-settings-nav-group">
                    <p id={`settings-group-${group.id}`} className="cx-settings-nav-label">
                      {t(`people.settings.groups.${group.id}`)}
                    </p>
                    <ul aria-labelledby={`settings-group-${group.id}`}>
                      {group.sections.map((id) => {
                        const Icon = SECTION_ICONS[id];
                        return (
                          <li key={id}>
                            <a
                              href={`/settings/${id}`}
                              className="cx-settings-nav-item"
                              aria-current={section === id ? 'page' : undefined}
                              onClick={(event) => {
                                event.preventDefault();
                                go(id);
                              }}
                            >
                              <Icon size={15} aria-hidden="true" className="cx-settings-nav-icon" />
                              {t(`people.settings.sections.${id}`)}
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </nav>
            </SettingsFilter>
          </div>
          <div
            ref={pages}
            data-testid="settings-pages"
            className="cx-settings-pages"
            onScrollCapture={(event) => {
              const page = event.target as HTMLElement;
              if (page.id === section) scrolls.current[section] = page.scrollTop;
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </ActiveSettingsPage.Provider>
  );
}
