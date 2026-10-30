/// <reference types="node" />
import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../../../index.html?raw';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../../../src-tauri/tauri.conf.json';
import { applyTheme } from '../../lib/theme';

const bridge = vi.hoisted(() => ({
  native: true,
  maximized: false,
  fullscreen: false,
  resized: undefined as (() => void) | undefined,
  isMaximized: vi.fn(async (): Promise<boolean> => bridge.maximized),
  isFullscreen: vi.fn(async (): Promise<boolean> => bridge.fullscreen),
  onResized: vi.fn(async (handler: () => void) => {
    bridge.resized = handler;
    return () => {};
  }),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => bridge.native }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => bridge }));
import { WindowChromeProvider } from './WindowChrome';
import { WindowFrame } from './WindowFrame';

const tokens = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../index.css'),
  'utf8'
);

beforeEach(() => {
  vi.clearAllMocks();
  bridge.native = true;
  bridge.maximized = false;
  bridge.fullscreen = false;
  bridge.resized = undefined;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function frame() {
  render(
    <WindowChromeProvider>
      <WindowFrame>
        <button>Workspace action</button>
      </WindowFrame>
    </WindowChromeProvider>
  );
  return screen.getByTestId('window-frame');
}

describe('outer native window corners', () => {
  it('enables real native/webview transparency without effects or private APIs', () => {
    expect(config.app.windows.find((window) => window.label === 'main')).toMatchObject({
      transparent: true,
      backgroundColor: [0, 0, 0, 0],
      decorations: false,
      resizable: true,
    });
    expect(config.app.windows[0]).not.toHaveProperty('windowEffects');
    expect(config.app).not.toHaveProperty('macOSPrivateApi', true);
  });

  it('uses the existing 10px radius inside the native gutter, including the 3px diagonal', async () => {
    const element = frame();
    await screen.findByTestId('window-resize-NorthWest');
    expect(tokens).toMatch(/--radius-md:\s*10px;/);
    expect(element.style.borderRadius).toBe('var(--radius-md)');
    expect(element).toHaveStyle({ padding: '10px' });
    expect(element).toHaveClass('overflow-hidden', 'bg-background');
    // For all four corners, the radius must contain the existing native 3px hit.
    const radius = Number(tokens.match(/--radius-md:\s*(\d+)px;/)![1]);
    expect(2 * (radius - 3) ** 2).toBeLessThan(radius ** 2);
    expect(document.querySelectorAll('[data-window-resize]')).toHaveLength(8);
  });

  it.each(['maximized', 'fullscreen'] as const)(
    'squares a known %s window and rounds it again after restore',
    async (state) => {
      bridge[state] = true;
      const element = frame();
      await act(async () => {});
      expect(element.style.borderRadius).toBe('0px');
      expect(element).toHaveStyle({ padding: '0px' });
      expect(document.querySelectorAll('[data-window-resize]')).toHaveLength(0);
      bridge[state] = false;
      await act(async () => bridge.resized?.());
      expect(element.style.borderRadius).toBe('var(--radius-md)');
      expect(element).toHaveStyle({ padding: '10px' });
      expect(document.querySelectorAll('[data-window-resize]')).toHaveLength(8);
      bridge[state] = true;
      await act(async () => bridge.resized?.());
      expect(element.style.borderRadius).toBe('0px');
      expect(element).toHaveStyle({ padding: '0px' });
      expect(bridge.onResized).toHaveBeenCalledOnce();
    }
  );

  it('keeps rounded layout while native state is pending or fails without enabling resize', async () => {
    let reject!: (error: Error) => void;
    bridge.isFullscreen.mockImplementationOnce(
      () => new Promise<boolean>((_, no) => (reject = no))
    );
    const element = frame();
    expect(element.style.borderRadius).toBe('var(--radius-md)');
    expect(element).toHaveStyle({ padding: '10px' });
    expect(document.querySelectorAll('[data-window-resize]')).toHaveLength(0);
    await act(async () => reject(new Error('Native state unavailable')));
    expect(element.style.borderRadius).toBe('var(--radius-md)');
    expect(element).toHaveStyle({ padding: '10px' });
    expect(document.querySelectorAll('[data-window-resize]')).toHaveLength(0);
  });

  it('keeps browser preview opaque and square without native gutter or subscription', () => {
    bridge.native = false;
    const element = frame();
    expect(element.style.borderRadius).toBe('0px');
    expect(element).toHaveStyle({ padding: '0px' });
    expect(element).toHaveClass('bg-background');
    expect(document.querySelectorAll('[data-window-resize]')).toHaveLength(0);
    expect(bridge.onResized).not.toHaveBeenCalled();
  });
});

describe('Linux resize margin outside the visible surface', () => {
  beforeEach(() => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Linux WebKitGTK');
  });

  it('keeps the gutter transparent and rounds a shadowed surface inside it', async () => {
    const element = frame();
    await screen.findByTestId('window-resize-NorthWest');
    const surface = screen.getByTestId('window-surface');
    expect(element).toHaveAttribute('data-resize-outside', 'true');
    expect(element).toHaveClass('bg-transparent');
    expect(element).not.toHaveClass('bg-background');
    expect(element).toHaveStyle({ padding: '10px' });
    expect(element.style.borderRadius).toBe('0px');
    expect(surface).toHaveClass('overflow-hidden', 'bg-background');
    expect(surface.style.borderRadius).toBe('var(--radius-md)');
    expect(surface.style.boxShadow).not.toBe('');
    expect(surface).toContainElement(screen.getByRole('button', { name: 'Workspace action' }));
    // Hit regions stay siblings of the surface, so they cover only the margin.
    for (const region of document.querySelectorAll('[data-window-resize]'))
      expect(surface).not.toContainElement(region as HTMLElement);
  });

  it('fills the screen when maximized without remounting the workspace', async () => {
    const element = frame();
    await screen.findByTestId('window-resize-NorthWest');
    const action = screen.getByRole('button', { name: 'Workspace action' });
    bridge.maximized = true;
    await act(async () => bridge.resized?.());
    const surface = screen.getByTestId('window-surface');
    expect(element).toHaveAttribute('data-resize-outside', 'false');
    expect(element).toHaveClass('bg-background');
    expect(element).toHaveStyle({ padding: '0px' });
    expect(surface.style.borderRadius).toBe('');
    expect(surface.style.boxShadow).toBe('');
    expect(screen.getByRole('button', { name: 'Workspace action' })).toBe(action);
    bridge.maximized = false;
    await act(async () => bridge.resized?.());
    expect(element).toHaveAttribute('data-resize-outside', 'true');
    expect(screen.getByRole('button', { name: 'Workspace action' })).toBe(action);
  });

  it('leaves Windows with the opaque rounded gutter it resizes natively', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Windows NT 10.0 WebView2');
    const element = frame();
    await screen.findByTestId('window-resize-NorthWest');
    expect(element).toHaveAttribute('data-resize-outside', 'false');
    expect(element).toHaveClass('bg-background');
    expect(element.style.borderRadius).toBe('var(--radius-md)');
    expect(screen.getByTestId('window-surface').style.boxShadow).toBe('');
  });
});

describe('viewport clip ownership', () => {
  function tree() {
    return (
      <WindowChromeProvider>
        <WindowFrame>Workspace</WindowFrame>
      </WindowChromeProvider>
    );
  }

  it('mirrors the restored state before native queries settle and removes it on unmount', async () => {
    const view = render(tree());
    expect(document.documentElement.dataset.windowRounded).toBe('true');
    await act(async () => {});
    view.unmount();
    expect(document.documentElement.dataset.windowRounded).toBeUndefined();
  });

  it.each(['maximized', 'fullscreen'] as const)(
    'clears clipping for %s and reinstates it on restore',
    async (state) => {
      render(tree());
      await act(async () => {});
      bridge[state] = true;
      await act(async () => bridge.resized?.());
      expect(document.documentElement.dataset.windowRounded).toBeUndefined();
      bridge[state] = false;
      await act(async () => bridge.resized?.());
      expect(document.documentElement.dataset.windowRounded).toBe('true');
    }
  );

  it('does not clip browser preview or leave a marker after provider remount', async () => {
    const native = render(<StrictMode>{tree()}</StrictMode>);
    await act(async () => {});
    expect(document.documentElement.dataset.windowRounded).toBe('true');
    native.unmount();
    expect(document.documentElement.dataset.windowRounded).toBeUndefined();
    bridge.native = false;
    const preview = render(tree());
    expect(document.documentElement.dataset.windowRounded).toBeUndefined();
    preview.unmount();
    bridge.native = true;
    render(tree());
    await act(async () => {});
    expect(document.documentElement.dataset.windowRounded).toBe('true');
  });

  it('does not let an older owner cleanup erase the newer frame decision', async () => {
    const older = render(tree());
    await act(async () => {});
    const newer = render(tree());
    await act(async () => {});
    older.unmount();
    expect(document.documentElement.dataset.windowRounded).toBe('true');
    newer.unmount();
    expect(document.documentElement.dataset.windowRounded).toBeUndefined();
  });

  it('restores the remaining owner when an overlapping newer frame unmounts', async () => {
    const older = render(tree());
    await act(async () => {});
    bridge.maximized = true;
    const newer = render(tree());
    await act(async () => {});
    expect(document.documentElement.dataset.windowRounded).toBeUndefined();
    newer.unmount();
    expect(document.documentElement.dataset.windowRounded).toBe('true');
    older.unmount();
    expect(document.documentElement.dataset.windowRounded).toBeUndefined();
  });
});

describe('real inline first paint and theme transitions', () => {
  const page = new DOMParser().parseFromString(indexHtml, 'text/html');
  const script = page.querySelector('head script')!.textContent!;

  function firstPaint(native: boolean, preference: string | null, systemDark: boolean) {
    const doc = document.implementation.createHTMLDocument();
    doc.head.innerHTML = page.head.innerHTML;
    doc.body.innerHTML = page.body.innerHTML;
    doc.body.className = page.body.className;
    const storage = { getItem: () => preference };
    new Function('window', 'document', 'localStorage', script)(
      { isTauri: native, matchMedia: () => ({ matches: systemDark }) },
      doc,
      storage
    );
    return doc;
  }

  it.each([
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['auto', true, 'dark'],
    [null, false, 'light'],
  ])('preserves native alpha for preference %s and OS dark=%s', (pref, dark, theme) => {
    const doc = firstPaint(true, pref, dark);
    expect(doc.documentElement.dataset.nativeWindow).toBe('true');
    expect(doc.documentElement.dataset.theme).toBe(theme);
    expect(doc.documentElement.style.backgroundColor).toBe('transparent');
    // The early stylesheet outlives applyTheme removing the inline background.
    const stylesheet = doc.querySelector('head style')!;
    expect(stylesheet).not.toBeNull();
    const mounted = document.createElement('style');
    mounted.textContent =
      'html, body { background-color: rgb(246, 245, 241); }' + stylesheet.textContent;
    document.head.append(mounted);
    try {
      for (const next of ['dark', 'light'] as const) {
        document.documentElement.dataset.nativeWindow = 'true';
        applyTheme(next);
        for (const surface of [document.documentElement, document.body]) {
          expect(getComputedStyle(surface).backgroundColor).toBe('rgba(0, 0, 0, 0)');
        }
      }
    } finally {
      mounted.remove();
      delete document.documentElement.dataset.nativeWindow;
      applyTheme('light');
    }
  });

  it.each([
    ['light', '#f6f5f1'],
    ['dark', '#242528'],
  ])('keeps normal browser first paint opaque in %s', (theme, color) => {
    const doc = firstPaint(false, theme, false);
    expect(doc.documentElement.dataset.nativeWindow).toBeUndefined();
    const expected = document.createElement('div');
    expected.style.backgroundColor = color;
    expect(doc.documentElement.style.backgroundColor).toBe(expected.style.backgroundColor);
    expect(doc.body.classList.contains('bg-background')).toBe(true);
  });

  it('keeps native alpha when storage is blocked before React', () => {
    const doc = document.implementation.createHTMLDocument();
    new Function('window', 'document', 'localStorage', script)(
      { isTauri: true, matchMedia: () => ({ matches: true }) },
      doc,
      {
        getItem: () => {
          throw new Error('Storage blocked');
        },
      }
    );
    expect(doc.documentElement.style.backgroundColor).toBe('transparent');
    expect(doc.documentElement.dataset.theme).toBe('dark');
  });
});
