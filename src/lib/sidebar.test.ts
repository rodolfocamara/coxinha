import { afterEach, expect, it, vi } from 'vitest';
import { createSidebarStore, SIDEBAR_STORAGE_KEY } from './sidebar';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it('persists collapse and restores it in a fresh store', () => {
  localStorage.clear();
  const first = createSidebarStore();
  expect(first.getState().open).toBe(true);
  first.getState().setOpen(false);
  expect(createSidebarStore().getState().open).toBe(false);
  first.getState().setOpen(true);
  expect(createSidebarStore().getState().open).toBe(true);
});
it.each(['invalid', 'null', '{}', '"false"'])(
  'defaults expanded for malformed preference %s',
  (raw) => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, raw);
    expect(createSidebarStore().getState().open).toBe(true);
  }
);
it('keeps working when storage access throws', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  const store = createSidebarStore();
  expect(store.getState().open).toBe(true);
  store.getState().setOpen(false);
  expect(store.getState().open).toBe(false);
});
