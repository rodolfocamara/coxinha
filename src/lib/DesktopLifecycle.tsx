import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { flushPendingSaves, setExitLocked, FlushFailure } from './lifecycle';
import {
  DesktopRecoveryDialog,
  type RecoveryAction,
  type RecoveryRequest,
} from './DesktopRecoveryDialog';

export function DesktopLifecycle() {
  const { t } = useTranslation();
  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryRequest | null>(null);
  const [answering, setAnswering] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const active = useRef<string | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const currentRecovery = useRef<RecoveryRequest | null>(null);

  // The portal is a sibling of the app root. Native window disabling would also
  // disable recovery controls, so only background DOM and keyboard input lock.
  useLayoutEffect(() => {
    if (!locked || !overlay.current) return;
    const background = [...document.body.children].filter(
      (node) => node !== overlay.current
    ) as HTMLElement[];
    const prior = background.map((node) => node.hasAttribute('inert'));
    background.forEach((node) => node.setAttribute('inert', ''));
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !overlay.current?.contains(event.target)) {
        overlay.current
          ?.querySelector<HTMLElement>('[role="dialog"] button:not(:disabled)')
          ?.focus();
        if (document.activeElement === event.target && event.target instanceof HTMLElement)
          event.target.blur();
      }
    };
    document.addEventListener('focusin', containFocus, true);
    return () => {
      background.forEach((node, i) => {
        if (!prior[i]) node.removeAttribute('inert');
      });
      document.removeEventListener('focusin', containFocus, true);
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, [locked]);

  useEffect(() => {
    let disposed = false;
    let ready = false;
    const retiredRequests = new Set<string>();
    const lock = () => {
      if (!active.current && document.activeElement instanceof HTMLElement) {
        previousFocus.current = document.activeElement;
        document.activeElement.blur();
      }
      setExitLocked(true);
      setLocked(true);
    };
    const preventEditing = (event: Event) => {
      if (
        active.current &&
        !(event.target instanceof Node && overlay.current?.contains(event.target))
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    ['keydown', 'beforeinput', 'compositionstart', 'pointerdown', 'click'].forEach((name) =>
      window.addEventListener(name, preventEditing, true)
    );
    const saveError = () => {
      setSaveFailed(true);
      void invoke('desktop_diagnostic', { category: 'save_failed' }).catch(() => {});
    };
    window.addEventListener('coxinha-save-error', saveError);
    // Register recovery/abort before flush. Flush delivery is retried by native
    // until started is received; registration races cannot imply an empty save.
    const listeners = [
      listen<string>('desktop-exit-aborted', ({ payload }) => {
        if (disposed || payload !== active.current) return;
        retiredRequests.add(payload);
        active.current = null;
        currentRecovery.current = null;
        clearTimeout(timer.current);
        setExitLocked(false);
        setLocked(false);
        setSaving(false);
        setRecovery(null);
        setAnswering(false);
      }),
      listen<RecoveryRequest>('desktop-recovery', ({ payload }) => {
        if (
          disposed ||
          payload.requestId !== active.current ||
          !['save_failed', 'attachment_pending', 'flush_delayed', 'shutdown_failed'].includes(
            payload.reason
          )
        )
          return;
        clearTimeout(timer.current);
        currentRecovery.current = payload;
        setSaving(false);
        setRecovery(payload);
        setAnswering(false);
      }),
      listen<string>('desktop-flush', async ({ payload }) => {
        if (
          !ready ||
          disposed ||
          !payload ||
          active.current === payload ||
          retiredRequests.has(payload)
        )
          return;
        lock();
        if (active.current) retiredRequests.add(active.current);
        active.current = payload;
        currentRecovery.current = null;
        setRecovery(null);
        setAnswering(false);
        setSaving(false);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          if (!disposed && active.current === payload && !currentRecovery.current) setSaving(true);
        }, 750);
        try {
          await invoke('desktop_flush_started', { requestId: payload });
          if (disposed || active.current !== payload) return;
          await flushPendingSaves();
          if (!disposed && active.current === payload)
            await invoke('desktop_flush_result', {
              requestId: payload,
              success: true,
              reason: null,
            });
        } catch (error) {
          if (disposed || active.current !== payload) return;
          const reason = error instanceof FlushFailure ? error.category : 'save_failed';
          void invoke('desktop_diagnostic', { category: reason }).catch(() => {});
          await invoke('desktop_flush_result', {
            requestId: payload,
            success: false,
            reason,
          }).catch(() => {});
        }
      }),
    ];
    // Each listener can fail independently. A missing listener produces an
    // emergency timeout, never an acknowledgement of durable completion.
    void Promise.all(listeners)
      .then(() => {
        ready = !disposed;
      })
      .catch(() => {});
    listeners.forEach((promise) => {
      void promise
        .then((stop) => {
          if (disposed) stop();
        })
        .catch(() => {});
    });
    const report = (category: string, line?: number, column?: number) => {
      void invoke('desktop_diagnostic', {
        category,
        line: line ?? null,
        column: column ?? null,
      }).catch(() => {});
    };
    const error = (event: ErrorEvent) => report('frontend_error', event.lineno, event.colno);
    const rejection = () => report('frontend_rejection');
    window.addEventListener('error', error);
    window.addEventListener('unhandledrejection', rejection);
    return () => {
      disposed = true;
      clearTimeout(timer.current);
      listeners.forEach((promise) => {
        void promise.then((stop) => stop()).catch(() => {});
      });
      ['keydown', 'beforeinput', 'compositionstart', 'pointerdown', 'click'].forEach((name) =>
        window.removeEventListener(name, preventEditing, true)
      );
      window.removeEventListener('coxinha-save-error', saveError);
      window.removeEventListener('error', error);
      window.removeEventListener('unhandledrejection', rejection);
      // A remount must be allowed to receive the retransmitted flush.
      active.current = null;
      setExitLocked(false);
    };
  }, []);
  const presented = useCallback(() => {
    const request = currentRecovery.current;
    if (request)
      void invoke('desktop_recovery_response', {
        requestId: request.requestId,
        recoveryId: request.recoveryId,
        action: 'presented',
      }).catch(() => {});
  }, []);
  const respond = (action: RecoveryAction) => {
    const request = currentRecovery.current;
    if (!request || answering) return;
    setAnswering(true);
    void invoke('desktop_recovery_response', {
      requestId: request.requestId,
      recoveryId: request.recoveryId,
      action,
    })
      .then(() => {
        if (action === 'retry' && currentRecovery.current === request) {
          currentRecovery.current = null;
          setRecovery(null);
          setAnswering(false);
          setSaving(true);
        }
      })
      .catch(() => {
        if (currentRecovery.current === request) setAnswering(false);
      });
    // Native cancellation owns unlocking; a reply alone is not completion.
  };
  return (
    <>
      {createPortal(
        <div ref={overlay} data-desktop-lifecycle="">
          {recovery ? (
            <DesktopRecoveryDialog
              recovery={recovery}
              busy={answering}
              onAction={respond}
              onPresented={presented}
            />
          ) : (
            saving && (
              <div
                role="status"
                aria-live="polite"
                className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
              >
                <p className="rounded-lg bg-background p-6">{t('desktopRecovery.saving')}</p>
              </div>
            )
          )}
        </div>,
        document.body
      )}
      {saveFailed && !locked && (
        <div role="alert" className="fixed bottom-4 left-4 z-[9998] border bg-background p-4">
          {t('desktopRecovery.saveFailed')}
          <button
            className="ml-4"
            onClick={() =>
              void flushPendingSaves()
                .then(() => setSaveFailed(false))
                .catch(() => {})
            }
          >
            {t('desktopRecovery.retry')}
          </button>
        </div>
      )}
    </>
  );
}
