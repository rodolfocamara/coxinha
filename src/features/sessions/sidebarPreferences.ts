import { create } from 'zustand';

const KEY = 'coxinha:session-sidebar';
function read(): { collapsed: boolean; groups: string[] } {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      collapsed: stored.collapsed === true,
      groups: Array.isArray(stored.groups)
        ? stored.groups.filter((key: unknown): key is string => typeof key === 'string').slice(-64)
        : ([] as string[]),
    };
  } catch {
    return { collapsed: false, groups: [] as string[] };
  }
}
/** Sidebar presentation only; never consumed by Calendar's full-view groups. */
export const useSessionSidebarPreferences = create(read);
useSessionSidebarPreferences.subscribe((state) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // A denied/full storage must never prevent navigation.
  }
});
export function toggleSessionGroup(key: string) {
  useSessionSidebarPreferences.setState(({ groups }) => ({
    groups: groups.includes(key)
      ? groups.filter((item) => item !== key)
      : [...groups, key].slice(-64),
  }));
}
