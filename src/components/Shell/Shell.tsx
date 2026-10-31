import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { WindowChromeProvider } from '../AppShell/WindowChrome';
import { WindowFrame } from '../AppShell/WindowFrame';
import { RecorderStrip } from '../../features/capture/RecorderStrip';
import { NavRail } from './NavRail';
import './shell.css';

export const AMBIENT_PREF = 'coxinha:ambient-gradient';
export const AMBIENT_EVENT = 'coxinha:ambient-changed';

export function ambientEnabled() {
  try {
    return localStorage.getItem(AMBIENT_PREF) !== 'off';
  } catch {
    return true;
  }
}

export function setAmbientEnabled(on: boolean) {
  try {
    localStorage.setItem(AMBIENT_PREF, on ? 'on' : 'off');
  } catch {
    /* Applies for this run only. */
  }
  window.dispatchEvent(new Event(AMBIENT_EVENT));
}

/** Window frame, ambient background, strip slot, rail slot and the main view. */
export function ShellFrame({
  strip,
  nav,
  children,
}: {
  strip: ReactNode;
  nav: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <WindowChromeProvider>
      <WindowFrame>
        <div className="cx-app">
          <a
            href="#canvas"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm"
          >
            {t('a11y.skipToCanvas')}
          </a>
          {strip}
          <div className="cx-body">
            {nav}
            <main id="canvas" data-shell-view className="cx-view">
              {children}
            </main>
          </div>
        </div>
      </WindowFrame>
    </WindowChromeProvider>
  );
}

/**
 * Persistent frame for every route (spec 0096 P2): recorder strip on top
 * (also the window title bar), labelled rail, one main view. Mounted once in
 * the root layout so the rail indicator and the strip survive navigation.
 */
export function Shell({ children }: { children: ReactNode }) {
  useEffect(() => {
    const apply = () => {
      if (ambientEnabled()) delete document.documentElement.dataset.ambient;
      else document.documentElement.dataset.ambient = 'off';
    };
    apply();
    window.addEventListener(AMBIENT_EVENT, apply);
    return () => window.removeEventListener(AMBIENT_EVENT, apply);
  }, []);
  return (
    <ShellFrame strip={<RecorderStrip />} nav={<NavRail />}>
      {children}
    </ShellFrame>
  );
}
