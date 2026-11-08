import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Theme } from './theme';

export interface NativeThemeSource {
  read(): Promise<Theme | null>;
  listen(handler: (theme: Theme) => void): Promise<() => void>;
}

export function nativeThemeSource(): NativeThemeSource | undefined {
  try {
    if (!isTauri()) return undefined;
    // Linux must follow WebKit's live prefers-color-scheme. In the installed
    // tao 0.34.8, platform_impl/linux/window.rs::theme (line 1027) derives
    // the native result from GTK theme-name suffixes, ignoring the desktop
    // portal's appearance preference. A light native result can therefore
    // overwrite a correct dark WebKit result (e.g. Breeze + prefer-dark).
    // Windows/macOS retain the native window source.
    if (typeof navigator !== 'undefined' && /Linux/i.test(navigator.userAgent)) {
      return undefined;
    }
    const current = getCurrentWindow();
    return {
      read: () => current.theme(),
      listen: (handler) => current.onThemeChanged(({ payload }) => handler(payload)),
    };
  } catch {
    // Older/test bridges may expose IPC without initialized window metadata.
    return undefined;
  }
}
