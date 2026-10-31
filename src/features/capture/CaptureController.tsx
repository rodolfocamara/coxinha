import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useQueryClient } from '@tanstack/react-query';
import { library } from '../meetings/library';
import { refreshSessionList } from '../sessions/sessions';
import { refreshCapture } from './captureActions';
import { useCaptureStore } from './captureStore';

/** Emitted by the library worker when capture or processing state changes (ADR 0022). */
export const CAPTURE_CHANGED_EVENT = 'capture-changed';
const LIVE_POLL_MS = 333;
const IDLE_POLL_MS = 3000;

function signature() {
  const { status } = useCaptureStore.getState();
  return [
    status?.active?.meetingId ?? '',
    status?.active?.paused ?? '',
    status?.processing?.meetingId ?? '',
    status?.processing?.phase ?? '',
    status?.error ?? '',
  ].join('|');
}

/**
 * Headless, mounted once in the root layout. The only reader of
 * `library_status`: the event triggers a refresh, meters and the timer poll
 * fast only while a capture is live, and every state change invalidates the
 * session caches so lists and detail pages follow at once.
 */
export function CaptureController() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!library.available()) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = signature();
    let inFlight = false;
    let again = false;
    // One loop only: an event during a read schedules exactly one more read.
    const tick = async (): Promise<void> => {
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      clearTimeout(timer);
      await refreshCapture();
      inFlight = false;
      if (!live) return;
      if (again) {
        again = false;
        return tick();
      }
      const next = signature();
      if (next !== last) {
        last = next;
        window.dispatchEvent(new Event('coxinha:sessions-changed'));
        // The strip names the live meeting from this list even when no screen polls it.
        void refreshSessionList();
        void queryClient.invalidateQueries({ queryKey: ['session'] });
      }
      const active = !!useCaptureStore.getState().status?.active;
      timer = setTimeout(() => void tick(), active ? LIVE_POLL_MS : IDLE_POLL_MS);
    };
    void tick();
    let unlisten: (() => void) | undefined;
    void listen(CAPTURE_CHANGED_EVENT, () => void tick())
      .then((stop) => {
        if (live) unlisten = stop;
        else stop();
      })
      .catch(() => {
        /* Polling alone still converges. */
      });
    const onRefresh = () => void tick();
    window.addEventListener('coxinha:capture-refresh', onRefresh);
    return () => {
      live = false;
      clearTimeout(timer);
      unlisten?.();
      window.removeEventListener('coxinha:capture-refresh', onRefresh);
    };
  }, [queryClient]);
  return null;
}
