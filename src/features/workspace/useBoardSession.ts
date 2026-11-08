import { useCallback, useEffect, useState } from 'react';
import { boardSession } from '../board/persistence';

/** Loads the process-wide board session, autosaves 600 ms after a change and flushes on unmount. */
export function useBoardSession() {
  const [, render] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const load = useCallback(() => {
    setLoadError(false);
    void boardSession.load().catch(() => setLoadError(true));
  }, []);
  useEffect(() => boardSession.subscribe(() => render((n) => n + 1)), []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(
    () => () => {
      void boardSession.flush().catch(() => {});
    },
    []
  );
  const board = boardSession.get();
  const dirty = boardSession.dirty();
  const error = boardSession.error();
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      void boardSession.flush().catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [board, dirty]);
  return { board, dirty, error, loadError, load };
}
