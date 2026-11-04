import { useSyncExternalStore } from 'react';
import {
  THEME_APPLIED_EVENT,
  resolveThemePreference,
  getThemePreference,
  type Theme,
} from './theme';

function subscribe(changed: () => void): () => void {
  window.addEventListener(THEME_APPLIED_EVENT, changed);
  return () => window.removeEventListener(THEME_APPLIED_EVENT, changed);
}

function snapshot(): Theme {
  const applied = document.documentElement.getAttribute('data-theme');
  return applied === 'dark' || applied === 'light'
    ? applied
    : resolveThemePreference(getThemePreference());
}

/** Editors consume the same resolved theme that paints HTML and native controls. */
export function useResolvedTheme(): Theme {
  return useSyncExternalStore(subscribe, snapshot, () => 'light');
}
