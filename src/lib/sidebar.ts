import { create } from 'zustand';

export const SIDEBAR_STORAGE_KEY = 'coxinha:workspace-sidebar';

function readOpen(): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (raw === null) return true;
    const value: unknown = JSON.parse(raw);
    return typeof value === 'boolean' ? value : true;
  } catch {
    return true;
  }
}

/** Factory keeps persistence independently testable without resetting other stores. */
export function createSidebarStore() {
  return create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
    open: readOpen(),
    setOpen(open) {
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(open));
      } catch {
        // The sidebar still works when browser storage is unavailable.
      }
      set({ open });
    },
  }));
}

export const useSidebar = createSidebarStore();
