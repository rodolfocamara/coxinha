import { act, render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RootLayout } from './__root';
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  loadNotes: vi.fn().mockResolvedValue(undefined),
  newNote: vi.fn(),
  toggle: vi.fn(),
  invoke: vi.fn(),
  start: vi.fn(),
  handler: undefined as undefined | ((event: { payload: { route: string } }) => Promise<void>),
}));
vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useNavigate: () => mocks.navigate,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => false }));
vi.mock('../features/meetings/library', () => ({ library: { start: mocks.start } }));
vi.mock('../features/shell/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../lib/store', () => ({
  useAppStore: (select: (state: unknown) => unknown) => select(mocks),
}));
vi.mock('../lib/panels', () => ({
  useSidePanel: (select: (state: unknown) => unknown) => select({ toggle: mocks.toggle }),
}));
vi.mock('../lib/theme', () => ({
  followThemePreference: () => () => {},
  getThemePreference: () => 'system',
  THEME_PREF_EVENT: 'theme-preference',
}));
vi.mock('../lib/bindings', () => ({
  events: {
    navigate: {
      listen: async (handler: typeof mocks.handler) => {
        mocks.handler = handler;
        return () => {};
      },
    },
  },
}));
it('opens recording controls from the desktop shortcut without starting capture', async () => {
  render(<RootLayout />);
  await waitFor(() => expect(mocks.handler).toBeTypeOf('function'));
  await act(async () => {
    await mocks.handler!({ payload: { route: 'toggle-recording' } });
  });
  expect(mocks.navigate).toHaveBeenCalledWith({ to: '/meetings' });
  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalledWith('library_start', expect.anything());
  expect(mocks.invoke).not.toHaveBeenCalledWith('start_recording', expect.anything());
});
it('returns to the activity map from the brand without starting capture', async () => {
  mocks.navigate.mockClear();
  render(<RootLayout />);
  await act(async () => {
    window.dispatchEvent(new Event('coxinha:open-map'));
  });
  expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' });
  expect(mocks.start).not.toHaveBeenCalled();
});
