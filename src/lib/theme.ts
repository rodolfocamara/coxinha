import { nativeThemeSource, type NativeThemeSource } from './nativeTheme';

export type Theme = 'light' | 'dark';
export type ThemePreference = 'auto' | Theme;

const DARK_QUERY = '(prefers-color-scheme: dark)';
export const THEME_STORAGE_KEY = 'coxinha.themePref';

export function systemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme, root: Element = document.documentElement): void {
  if (theme === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
  root.setAttribute('data-theme', theme);
  (root as HTMLElement).style.colorScheme = theme;
  (root as HTMLElement).style.removeProperty('background-color');
  if (root === document.documentElement) {
    window.dispatchEvent(new Event(THEME_APPLIED_EVENT));
  }
}

export function getThemePreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'auto';
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    /* Restricted storage: follow OS. */
  }
  return raw === 'light' || raw === 'dark' ? raw : 'auto';
}

export const THEME_APPLIED_EVENT = 'coxinha:theme-applied';

export const THEME_PREF_EVENT = 'coxinha:theme-pref-changed';

// Write + broadcast together so callers can't forget the dispatch
// and let App.tsx drift out of sync with localStorage.
export function setThemePreference(pref: ThemePreference): void {
  if (typeof localStorage !== 'undefined') {
    if (pref === 'auto') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, pref);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(THEME_PREF_EVENT, { detail: pref }));
  }
}

export function followThemePreference(
  pref: ThemePreference,
  root: Element = document.documentElement,
  native?: NativeThemeSource
): () => void {
  if (pref !== 'auto') {
    applyTheme(pref, root);
    return () => {};
  }
  native ??= nativeThemeSource();
  let active = true;
  let revision = 0;
  let nativeReady = false;
  let unlisten: (() => void) | undefined;
  const mq =
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(DARK_QUERY) : undefined;
  const handle = (event: MediaQueryListEvent) => {
    if (!nativeReady && active) {
      revision++;
      applyTheme(event.matches ? 'dark' : 'light', root);
    }
  };
  applyTheme(systemTheme(), root);
  mq?.addEventListener('change', handle);
  if (native) {
    // Register before reading so an event arriving during the read wins.
    const initialRevision = revision;
    void native
      .listen((theme) => {
        if (!active) return;
        revision++;
        nativeReady = true;
        applyTheme(theme, root);
      })
      .then(async (stop) => {
        if (!active) {
          stop();
          return;
        }
        unlisten = stop;
        const theme = await native.read();
        if (active && theme && revision === initialRevision) {
          nativeReady = true;
          applyTheme(theme, root);
        }
      })
      .catch(() => {
        // Native support/permissions can be absent. Keep the live web fallback.
        if (active && !nativeReady) {
          nativeReady = false;
          applyTheme(systemTheme(), root);
        }
      });
  }
  return () => {
    active = false;
    mq?.removeEventListener('change', handle);
    unlisten?.();
  };
}

export function resolveThemePreference(pref: ThemePreference): Theme {
  return pref === 'auto' ? systemTheme() : pref;
}
