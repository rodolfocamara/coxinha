import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import './settings.css';

export const SETTINGS_SECTIONS = [
  'general',
  'recording',
  'transcription',
  'integrations',
  'shortcuts',
  'storage',
  'diagnostics',
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];

/** Resolves `#<section>` or a legacy `#<x>-heading` to the element to focus and its section. */
export function resolveSettingsTarget(hash: string, root: ParentNode = document) {
  const id = hash.replace(/^#/, '');
  if (!id) return null;
  const target = root.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
  if (!target) return null;
  const section = target.closest<HTMLElement>('[data-settings-section]');
  if (!section) return null;
  const focus = target === section ? (section.querySelector<HTMLElement>('h2') ?? section) : target;
  return { focus, section: section.id as SettingsSectionId };
}

/** Scrolls only the settings column (scrollIntoView would also scroll the shell). */
function focusTarget(element: HTMLElement, box: HTMLElement | null) {
  element.tabIndex = -1;
  element.focus({ preventScroll: true });
  if (!box) return;
  const top = element.getBoundingClientRect().top - box.getBoundingClientRect().top;
  box.scrollTop = Math.max(0, box.scrollTop + top - 16);
}

/**
 * Ajustes frame: section list (220px) beside one scrolling content column.
 * The list follows the scroll; choosing a section scrolls to it and moves
 * focus to its heading.
 */
export function SettingsLayout({
  children,
  ready,
  initialSection,
}: {
  children: ReactNode;
  /** Sections are rendered; deep links can resolve. */
  ready: boolean;
  initialSection?: string;
}) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<SettingsSectionId>('general');
  // Programmatic jumps scroll too; the chosen section wins until the scroll settles.
  const jumpedAt = useRef(0);

  // TanStack's hash scroll (and the browser's) call scrollIntoView, which
  // also scrolls the clipped shell containers. Ancestors of this view never
  // scroll on purpose, so pin them while Ajustes is mounted.
  useEffect(() => {
    const ancestors = new Set<Element>();
    for (let el = root.current?.parentElement; el; el = el.parentElement) ancestors.add(el);
    const pin = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && ancestors.has(target)) target.scrollTo(0, 0);
    };
    document.addEventListener('scroll', pin, true);
    return () => document.removeEventListener('scroll', pin, true);
  }, []);

  useEffect(() => {
    if (!ready || !initialSection || !content.current) return;
    const target = resolveSettingsTarget(initialSection, content.current);
    if (!target) return;
    jumpedAt.current = Date.now();
    setActive(target.section);
    focusTarget(target.focus, content.current);
  }, [ready, initialSection]);

  function onScroll() {
    const box = content.current;
    if (!box) return;
    if (Date.now() - jumpedAt.current < 400) return;
    const sections = [...box.querySelectorAll<HTMLElement>('[data-settings-section]')];
    if (!sections.length) return;
    const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
    const top = box.getBoundingClientRect().top + 32;
    const current = atEnd
      ? sections[sections.length - 1]
      : (sections.filter((s) => s.getBoundingClientRect().top <= top).pop() ?? sections[0]);
    setActive(current.id as SettingsSectionId);
  }

  function go(id: SettingsSectionId) {
    const section = content.current?.querySelector<HTMLElement>(`#${id}`);
    setActive(id);
    if (!section) return;
    jumpedAt.current = Date.now();
    focusTarget(section.querySelector<HTMLElement>('h2') ?? section, content.current);
  }

  return (
    <div
      ref={root}
      className="flex h-full min-h-0 text-ui"
      aria-labelledby="settings-heading"
      role="region"
    >
      <div className="flex w-[220px] shrink-0 flex-col border-r border-border">
        <div className="px-3.5 pt-3.5 pb-2">
          <h1 id="settings-heading" className="text-base font-semibold">
            {t('people.settings.title')}
          </h1>
        </div>
        <nav
          aria-label={t('people.settings.sectionsLabel')}
          className="min-h-0 flex-1 overflow-auto"
        >
          <ul>
            {SETTINGS_SECTIONS.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  className="cx-settings-nav-item"
                  aria-current={active === id ? 'true' : undefined}
                  onClick={() => go(id)}
                >
                  {t(`people.settings.sections.${id}`)}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div
        ref={content}
        data-testid="settings-scroll"
        className="h-full min-w-0 flex-1 overflow-auto"
        onScroll={onScroll}
      >
        <div className="max-w-[820px] px-6 py-4">{children}</div>
      </div>
    </div>
  );
}
