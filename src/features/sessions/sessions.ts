import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect } from 'react';
import { create } from 'zustand';
import type { LibraryMeeting } from '../meetings/library';

export type SessionInput = {
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  status: 'planned' | 'active' | 'completed' | 'cancelled';
};
export type Session = SessionInput & {
  id: string;
  origin: 'manual' | 'recording';
  meeting_id: string | null;
  personal_note: { id: string; relative_path: string } | null;
  created_at: string;
  note_error: string | null;
  transcript_status?: 'available' | 'none' | 'empty' | 'unavailable';
  processing_state?: string | null;
  processing?: { phase: string; meetingId: string } | null;
  recording: LibraryMeeting | null;
  /** Backend truth for a running capture of this session (spec 0096 P1). */
  live?: { paused: boolean } | null;
};
export const sessions = {
  available: isTauri,
  list: () => invoke<Session[]>('library_sessions'),
  detail: (sessionId: string) => invoke<Session>('library_session', { sessionId }),
  create: (input: SessionInput) => invoke<Session>('library_create_session', { input }),
  update: (sessionId: string, input: SessionInput) =>
    invoke<Session>('library_update_session', { sessionId, input }),
  ensureNote: (sessionId: string) => invoke<Session>('library_ensure_personal_note', { sessionId }),
};
const changed = 'coxinha:sessions-changed';
/** In-memory cache survives route shells; never persisted or shared across app starts. */
export const sessionListCache = create<{
  data: Session[] | undefined;
  isError: boolean;
  updatedAt: number;
}>(() => ({ data: undefined, isError: false, updatedAt: 0 }));
let loading: Promise<void> | null = null;
let dirtyGeneration = 0;
async function loadSessions(force = false): Promise<void> {
  if (loading) return loading;
  const state = sessionListCache.getState();
  if (!force && state.data && Date.now() - state.updatedAt < 3000) return;
  loading = (async () => {
    let observedGeneration: number;
    do {
      observedGeneration = dirtyGeneration;
      try {
        const data = await sessions.list();
        if (observedGeneration === dirtyGeneration)
          sessionListCache.setState({ data, isError: false, updatedAt: Date.now() });
      } catch {
        if (observedGeneration === dirtyGeneration) sessionListCache.setState({ isError: true });
      }
      // A response started before a mutation cannot satisfy its invalidation.
    } while (observedGeneration !== dirtyGeneration);
  })().finally(() => {
    loading = null;
  });
  return loading;
}
function invalidateSessions() {
  dirtyGeneration++;
  return loadSessions(true);
}
/** Refreshes the shared list without subscribing to polling (capture controller). */
export function refreshSessionList() {
  if (!sessions.available()) return Promise.resolve();
  return invalidateSessions();
}
export function useSessions() {
  const state = sessionListCache();
  useEffect(() => {
    if (!sessions.available()) return;
    void loadSessions();
    const timer = setInterval(() => void loadSessions(true), 3000);
    const refresh = () => void invalidateSessions();
    window.addEventListener(changed, refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener(changed, refresh);
    };
  }, []);
  return { ...state, isPending: !state.data && !state.isError, refetch: invalidateSessions };
}
export function useRefreshSessions() {
  return async () => {
    window.dispatchEvent(new Event(changed));
  };
}
