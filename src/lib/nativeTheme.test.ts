import { afterEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  read: vi.fn(async () => 'light' as const),
  listen: vi.fn(async () => () => {}),
  current: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: bridge.current }));

import { nativeThemeSource } from './nativeTheme';
import { followThemePreference } from './theme';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function desktop(userAgent: string) {
  vi.stubGlobal('navigator', { userAgent });
  bridge.current.mockReturnValue({ theme: bridge.read, onThemeChanged: bridge.listen });
}

describe('desktop theme source selection', () => {
  it('keeps Linux media dark even when native GTK theme would report light', async () => {
    desktop('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15');
    const listeners = new Set<(event: { matches: boolean }) => void>();
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: (_: string, handler: (event: { matches: boolean }) => void) =>
        listeners.add(handler),
      removeEventListener: (_: string, handler: (event: { matches: boolean }) => void) =>
        listeners.delete(handler),
    }));
    const root = document.createElement('html');
    const cleanup = followThemePreference('auto', root);
    await Promise.resolve();
    expect(root.dataset.theme).toBe('dark');
    expect(bridge.current).not.toHaveBeenCalled();
    expect(bridge.read).not.toHaveBeenCalled();
    for (const listener of listeners) listener({ matches: false });
    expect(root.dataset.theme).toBe('light');
    cleanup();
    expect(listeners.size).toBe(0);
  });

  it.each([
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  ])('retains native window source on %s', async (userAgent) => {
    desktop(userAgent);
    const native = nativeThemeSource();
    expect(native).toBeDefined();
    await expect(native!.read()).resolves.toBe('light');
    await native!.listen(() => {});
    expect(bridge.read).toHaveBeenCalledOnce();
    expect(bridge.listen).toHaveBeenCalledOnce();
  });
});
