import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  followThemePreference,
  getThemePreference,
  resolveThemePreference,
  setThemePreference,
  systemTheme,
  THEME_STORAGE_KEY,
} from './theme';

type MqListener = (e: MediaQueryListEvent) => void;

interface FakeMediaQuery {
  matches: boolean;
  addEventListener: (type: 'change', l: MqListener) => void;
  removeEventListener: (type: 'change', l: MqListener) => void;
  dispatch: (matches: boolean) => void;
}

function fakeMatchMedia(initial: boolean): FakeMediaQuery {
  const listeners = new Set<MqListener>();
  const mq: FakeMediaQuery = {
    matches: initial,
    addEventListener: (_t, l) => listeners.add(l),
    removeEventListener: (_t, l) => listeners.delete(l),
    dispatch: (matches) => {
      mq.matches = matches;
      for (const l of listeners) l({ matches } as MediaQueryListEvent);
    },
  };
  return mq;
}

describe('theme helpers', () => {
  let root: Element;

  beforeEach(() => {
    root = document.createElement('html');
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applyTheme toggles the `.dark` class on the given root', () => {
    applyTheme('dark', root);
    expect(root.classList.contains('dark')).toBe(true);
    applyTheme('light', root);
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('systemTheme reads prefers-color-scheme', () => {
    const dark = fakeMatchMedia(true);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => dark)
    );
    expect(systemTheme()).toBe('dark');

    const light = fakeMatchMedia(false);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => light)
    );
    expect(systemTheme()).toBe('light');
  });

  it('followThemePreference("auto") applies the current value immediately', () => {
    const mq = fakeMatchMedia(true);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mq)
    );

    const cleanup = followThemePreference('auto', root);
    expect(root.classList.contains('dark')).toBe(true);
    cleanup();
  });

  it('followThemePreference("auto") reacts when the OS flips the preference', () => {
    const mq = fakeMatchMedia(false);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mq)
    );

    const cleanup = followThemePreference('auto', root);
    expect(root.classList.contains('dark')).toBe(false);

    mq.dispatch(true);
    expect(root.classList.contains('dark')).toBe(true);

    mq.dispatch(false);
    expect(root.classList.contains('dark')).toBe(false);

    cleanup();
  });

  it('cleanup function unbinds the listener', () => {
    const mq = fakeMatchMedia(false);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mq)
    );

    const cleanup = followThemePreference('auto', root);
    cleanup();

    mq.dispatch(true);
    expect(root.classList.contains('dark')).toBe(false);
  });
});

describe('theme preference', () => {
  let root: Element;

  beforeEach(() => {
    root = document.createElement('html');
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to "auto" when nothing is stored', () => {
    expect(getThemePreference()).toBe('auto');
  });

  it('persists explicit light/dark choices to localStorage', () => {
    setThemePreference('dark');
    expect(getThemePreference()).toBe('dark');
    setThemePreference('light');
    expect(getThemePreference()).toBe('light');
  });

  it('"auto" clears the stored value so next session re-reads the OS', () => {
    setThemePreference('dark');
    setThemePreference('auto');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(getThemePreference()).toBe('auto');
  });

  it('followThemePreference("dark") applies dark and ignores OS', () => {
    const mq = fakeMatchMedia(false);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mq)
    );

    const cleanup = followThemePreference('dark', root);
    expect(root.classList.contains('dark')).toBe(true);

    mq.dispatch(true);
    // The OS flipped to dark — already dark, stays dark. Flip OS back:
    mq.dispatch(false);
    // Preference "dark" ignores OS — still dark.
    expect(root.classList.contains('dark')).toBe(true);
    cleanup();
  });

  it('followThemePreference("light") applies light and ignores OS', () => {
    const mq = fakeMatchMedia(true);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mq)
    );

    const cleanup = followThemePreference('light', root);
    expect(root.classList.contains('dark')).toBe(false);

    mq.dispatch(true);
    // OS went dark but preference is light — stays light.
    expect(root.classList.contains('dark')).toBe(false);
    cleanup();
  });
});

describe('native theme lifecycle', () => {
  let root: HTMLElement;
  let mq: FakeMediaQuery;
  beforeEach(() => {
    root = document.createElement('html');
    mq = fakeMatchMedia(false);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mq)
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  }
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  it('uses native OS over browser and keeps color-scheme synchronized', async () => {
    let changed!: (theme: 'light' | 'dark') => void;
    const stop = vi.fn();
    const cleanup = followThemePreference('auto', root, {
      read: async () => 'dark',
      listen: async (handler) => {
        changed = handler;
        return stop;
      },
    });
    await flush();
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
    mq.dispatch(false);
    expect(root.dataset.theme).toBe('dark');
    changed('light');
    expect(root.classList.contains('dark')).toBe(false);
    cleanup();
    expect(stop).toHaveBeenCalledOnce();
    changed('dark');
    expect(root.dataset.theme).toBe('light');
  });

  it('a native event wins over an older in-flight native read', async () => {
    const read = deferred<'light' | 'dark'>();
    let changed!: (theme: 'light' | 'dark') => void;
    const cleanup = followThemePreference('auto', root, {
      read: () => read.promise,
      listen: async (handler) => {
        changed = handler;
        return () => {};
      },
    });
    await flush();
    changed('dark');
    read.resolve('light');
    await flush();
    expect(root.dataset.theme).toBe('dark');
    cleanup();
  });

  it('a newer browser event wins over an older native read', async () => {
    const read = deferred<'light' | 'dark'>();
    const cleanup = followThemePreference('auto', root, {
      read: () => read.promise,
      listen: async () => () => {},
    });
    await flush();
    mq.dispatch(true);
    read.resolve('light');
    await flush();
    expect(root.dataset.theme).toBe('dark');
    cleanup();
  });

  it('a manual override survives delayed native reads', async () => {
    const read = deferred<'light' | 'dark'>();
    const cleanup = followThemePreference('auto', root, {
      read: () => read.promise,
      listen: async () => () => {},
    });
    await flush();
    cleanup();
    followThemePreference('light', root);
    read.resolve('dark');
    await flush();
    expect(root.dataset.theme).toBe('light');
  });

  it('unsubscribes a listener that resolves after disposal without reading native state', async () => {
    const listening = deferred<() => void>();
    const stop = vi.fn();
    const read = vi.fn(async () => 'dark' as const);
    const cleanup = followThemePreference('auto', root, { read, listen: () => listening.promise });
    cleanup();
    listening.resolve(stop);
    await flush();
    expect(stop).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['listen', 'read'])(
    'keeps live browser fallback when native %s fails',
    async (failure) => {
      const cleanup = followThemePreference('auto', root, {
        read: async () => {
          throw new Error('unavailable');
        },
        listen: async () => {
          if (failure === 'listen') throw new Error('unavailable');
          return () => {};
        },
      });
      await flush();
      mq.dispatch(true);
      expect(root.dataset.theme).toBe('dark');
      cleanup();
      mq.dispatch(false);
      expect(root.dataset.theme).toBe('dark');
    }
  );

  it('explicit preferences never subscribe to or read the native OS', () => {
    const native = { read: vi.fn(), listen: vi.fn() };
    followThemePreference('dark', root, native)();
    expect(native.read).not.toHaveBeenCalled();
    expect(native.listen).not.toHaveBeenCalled();
  });
});

describe('native initialization edge cases', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('a failed read after a newer native event preserves the event', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => fakeMatchMedia(false))
    );
    const root = document.createElement('html');
    let changed!: (theme: 'light' | 'dark') => void;
    let reject!: () => void;
    const read = new Promise<never>((_, no) => {
      reject = () => no(new Error('read failed'));
    });
    const cleanup = followThemePreference('auto', root, {
      read: () => read,
      listen: async (handler) => {
        changed = handler;
        return () => {};
      },
    });
    await Promise.resolve();
    changed('dark');
    reject();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(root.dataset.theme).toBe('dark');
    cleanup();
  });

  it('falls back when a partial Tauri bridge lacks current window metadata', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => fakeMatchMedia(true))
    );
    const root = document.createElement('html');
    const cleanup = followThemePreference('auto', root);
    expect(root.dataset.theme).toBe('dark');
    cleanup();
  });
});

describe('pre-mount theme resolution', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });
  it.each(['light', 'dark'] as const)(
    'preserves explicit %s against opposite OS before React mounts',
    (pref) => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => fakeMatchMedia(pref !== 'dark'))
      );
      localStorage.setItem(THEME_STORAGE_KEY, pref);
      const root = document.createElement('html');
      applyTheme(resolveThemePreference(getThemePreference()), root);
      expect(root.dataset.theme).toBe(pref);
      expect(root.style.colorScheme).toBe(pref);
    }
  );
});
