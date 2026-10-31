import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { calendar, type CalendarSnapshot } from '../agenda/calendar';
import { boardSession } from '../board/persistence';
import { useAppStore } from '../../lib/store';

export type Loadable<T> = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; data: T };

/** One read of a source with an explicit retry; a failure never throws into render. */
function useLoad<T>(load: () => Promise<T>) {
  const [state, setState] = useState<Loadable<T>>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    load().then(
      (data) => active && setState({ kind: 'ready', data }),
      () => active && setState({ kind: 'error' })
    );
    return () => {
      active = false;
    };
    // `load` is read once per attempt; `retry` bumps `attempt` to run it again.
  }, [attempt]);
  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);
  return [state, retry] as const;
}

/** Cached Outlook snapshot only; opening Hoje never starts a sync or sign-in. */
export function useCalendarSnapshot() {
  return useLoad<CalendarSnapshot>(calendar.status);
}

/** The shared board session, so unsaved Workspace edits show here too. */
export function useBoardPreview() {
  const [state, retry] = useLoad(() => boardSession.load());
  const board = useSyncExternalStore(boardSession.subscribe, boardSession.get, boardSession.get);
  if (state.kind === 'ready' && board)
    return [{ kind: 'ready', data: board } as const, retry] as const;
  return [state, retry] as const;
}

/** Notes come from the app store; Hoje refreshes them once so recency is current. */
export function useRecentNotes() {
  const notes = useAppStore((s) => s.notes);
  const [state, retry] = useLoad(() => useAppStore.getState().loadNotes());
  return { notes, failed: state.kind === 'error', loading: state.kind === 'loading', retry };
}
