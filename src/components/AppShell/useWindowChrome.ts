import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

type ResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>['startResizeDragging']>[0];

function currentWindow() {
  try {
    return isTauri() ? getCurrentWindow() : undefined;
  } catch {
    return undefined;
  }
}

export function useWindowChrome() {
  const [native] = useState(currentWindow);
  const [maximized, setMaximized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // No resize targets until both native state queries have succeeded.
  const [resizeReady, setResizeReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);

  const lifecycle = useRef({ disposed: false, revision: 0 });
  const refresh = useCallback(async () => {
    if (!native || lifecycle.current.disposed) return;
    const request = ++lifecycle.current.revision;
    setFailed(false);
    try {
      const [value, full] = await Promise.all([native.isMaximized(), native.isFullscreen()]);
      if (!lifecycle.current.disposed && request === lifecycle.current.revision) {
        setMaximized(value);
        setFullscreen(full);
        setResizeReady(true);
      }
    } catch {
      if (!lifecycle.current.disposed && request === lifecycle.current.revision) {
        setResizeReady(false);
        setFailed(true);
      }
    }
  }, [native]);

  useEffect(() => {
    lifecycle.current.disposed = false;
    if (!native) return;
    let disposed = false;
    setSubscribed(false);
    let stop: (() => void) | undefined;
    void refresh();
    void native
      .onResized(() => void refresh())
      .then((unlisten) => {
        if (disposed) unlisten();
        else {
          stop = unlisten;
          setSubscribed(true);
        }
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      lifecycle.current.disposed = true;
      lifecycle.current.revision++;
      stop?.();
    };
  }, [native, refresh, retryRevision]);

  async function run(action: 'minimize' | 'toggleMaximize' | 'close' | 'startDragging') {
    if (!native || lifecycle.current.disposed) return;
    setFailed(false);
    try {
      // close() emits the native CloseRequested event; the existing lifecycle
      // owns save confirmation. Never bypass it with destroy() or process exit.
      await native[action]();
      if (action === 'toggleMaximize') await refresh();
    } catch {
      if (!lifecycle.current.disposed) setFailed(true);
    }
  }

  async function resize(direction: ResizeDirection, point: { x: number; y: number }) {
    if (!native || lifecycle.current.disposed) return;
    setFailed(false);
    const revision = lifecycle.current.revision;
    try {
      // Recheck OS state on the press: a native resize notification may still be queued.
      const linux = navigator.userAgent.includes('Linux');
      const [max, full, scale] = await Promise.all([
        native.isMaximized(),
        native.isFullscreen(),
        linux ? native.scaleFactor() : 1,
      ]);
      if (lifecycle.current.disposed || revision !== lifecycle.current.revision) return;
      if (max || full) {
        await refresh();
        return;
      }
      // runtime-wry 2.10.1 GTK multiplies its GDK inset by the window scale.
      // At scale >= 2 the native handler owns our entire 10px gutter. Query on
      // each press so monitor changes cannot leave a stale cached inset.
      if (linux) {
        if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid window scale');
        const inset = 5 * scale;
        if (
          point.x < inset ||
          point.y < inset ||
          point.x >= window.innerWidth - inset ||
          point.y >= window.innerHeight - inset
        )
          return;
      }
      await native.startResizeDragging(direction);
    } catch {
      if (!lifecycle.current.disposed) setFailed(true);
    }
  }

  return {
    native: Boolean(native),
    maximized,
    fullscreen,
    failed,
    run,
    resize,
    retry: () => setRetryRevision((revision) => revision + 1),
    resizable: Boolean(native) && subscribed && resizeReady && !maximized && !fullscreen,
  };
}
