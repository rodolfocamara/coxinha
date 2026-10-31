import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { CalendarDays, LayoutGrid, Mic, Search, Settings, Sun, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import brandMark from '../../assets/coxinha-mark.svg';
import { toggleCapture } from '../../features/capture/captureActions';
import { useCaptureStore } from '../../features/capture/captureStore';
import { prepareRouteTransition, setZoomOrigin, type TransitionKind } from '../../lib/motion';

export type NavArea = 'hoje' | 'meetings' | 'workspace' | 'people' | 'settings';

const AREA_PATH: Record<NavArea, string> = {
  hoje: '/',
  meetings: '/meetings',
  workspace: '/workspace',
  people: '/people',
  settings: '/settings',
};

/** Which rail item a path belongs to, including legacy paths that redirect. */
export function areaForPath(path: string): NavArea | null {
  if (path === '/' || path === '') return 'hoje';
  const first = path.split('/')[1];
  if (['meetings', 'sessions', 'calendar', 'agenda'].includes(first)) return 'meetings';
  if (['workspace', 'notes'].includes(first)) return 'workspace';
  if (first === 'people') return 'people';
  if (first === 'settings') return 'settings';
  return null;
}

/** Hoje sits "above" the Workspace: going between them zooms; the rest rises. */
export function transitionFor(from: NavArea | null, to: NavArea): TransitionKind {
  if (from === 'hoje' && to === 'workspace') return 'zoom';
  if (from === 'workspace' && to === 'hoje') return 'zoomout';
  return 'nav';
}

export function quickCaptureTitle(prefix: string, now = new Date()) {
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${prefix} ${time}`;
}

export function NavRail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const current = areaForPath(path);
  const live = useCaptureStore((s) => !!s.status?.active);
  const busy = useCaptureStore((s) => s.busy !== null);
  const indicator = useRef<HTMLSpanElement>(null);
  const items = useRef<Partial<Record<NavArea, HTMLButtonElement | null>>>({});

  useLayoutEffect(() => {
    const el = indicator.current;
    const target = current ? items.current[current] : null;
    if (!el) return;
    if (!target) {
      el.style.opacity = '0';
      return;
    }
    const first = el.style.opacity !== '1';
    if (first) el.style.transition = 'none';
    el.style.opacity = '1';
    el.style.height = `${target.offsetHeight}px`;
    el.style.transform = `translateY(${target.offsetTop}px)`;
    if (first) {
      void el.offsetWidth;
      el.style.transition = '';
    }
  }, [current]);

  const go = (area: NavArea) => {
    if (area === current) return;
    const kind = transitionFor(current, area);
    if (kind === 'zoom') setZoomOrigin(document.querySelector('[data-workspace-preview]'));
    void navigate({ to: AREA_PATH[area], viewTransition: prepareRouteTransition(kind) });
  };

  const item = (area: NavArea, icon: ReactNode, label: string) => (
    <button
      type="button"
      ref={(el) => {
        items.current[area] = el;
      }}
      className="cx-nav-item"
      aria-current={current === area ? 'page' : undefined}
      onClick={() => go(area)}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <nav className="cx-nav" aria-label={t('a11y.mainNavigation')}>
      <img src={brandMark} alt={t('brand.name')} className="cx-nav-logo" />
      <span ref={indicator} className="cx-nav-indicator" aria-hidden="true" />
      {item('hoje', <Sun size={16} aria-hidden="true" />, t('shell.nav.hoje'))}
      {item('meetings', <CalendarDays size={16} aria-hidden="true" />, t('shell.nav.meetings'))}
      {item('workspace', <LayoutGrid size={16} aria-hidden="true" />, t('shell.nav.workspace'))}
      {item('people', <Users size={16} aria-hidden="true" />, t('shell.nav.people'))}
      <button
        type="button"
        className="cx-nav-item"
        onClick={() => window.dispatchEvent(new Event('coxinha:open-palette'))}
      >
        <Search size={16} aria-hidden="true" />
        {t('shell.nav.search')}
      </button>
      <span className="cx-nav-spacer" />
      <button
        type="button"
        className="cx-rec-button"
        aria-pressed={live}
        disabled={busy}
        aria-label={t(live ? 'shell.record.stop' : 'shell.record.start')}
        title={t(live ? 'shell.record.stop' : 'shell.record.startHint')}
        onClick={() => void toggleCapture(quickCaptureTitle(t('shell.record.quickTitle')))}
      >
        <Mic size={16} aria-hidden="true" />
      </button>
      {item('settings', <Settings size={16} aria-hidden="true" />, t('shell.nav.settings'))}
    </nav>
  );
}
