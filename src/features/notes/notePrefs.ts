/** Note display preferences, global across notes (localStorage). */
export const PREF_FONT_KEY = 'coxinha:note-font';
export const PREF_SMALL_KEY = 'coxinha:note-small';
export const PREF_FULLWIDTH_KEY = 'coxinha:note-full-width';

export function readPrefString<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T
): T {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  return (allowed as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback;
}

export function readPrefBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === '1') return true;
  if (raw === '0') return false;
  return fallback;
}
