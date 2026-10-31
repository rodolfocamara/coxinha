import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { library } from '../meetings/library';
import { useSessions } from '../sessions/sessions';
import { useOutlookConnection } from '../agenda/useOutlookConnection';
import { isSessionLive, useCaptureStore } from '../capture/captureStore';
import { buildRows, type MeetingRow } from './meetingRows';

export const LIBRARY_LIST_KEY = ['meetings-hub', 'library-list'] as const;

/**
 * Everything the Reuniões list merges: meeting sessions (shared cache, polled),
 * the local Outlook cache (never starts authorization) and recordings.
 */
export function useMeetingsData() {
  const sessions = useSessions();
  const outlook = useOutlookConnection();
  const client = useQueryClient();
  const liveMeetingId = useCaptureStore((s) => s.status?.active?.meetingId ?? null);
  const recordings = useQuery({
    queryKey: [...LIBRARY_LIST_KEY, liveMeetingId],
    queryFn: () => library.list(),
    enabled: library.available(),
    retry: false,
  });
  const events = outlook.snapshot.events;
  const rows = useMemo(
    () => buildRows(sessions.data ?? [], events, recordings.data ?? []),
    [sessions.data, events, recordings.data]
  );
  const refreshRecordings = useCallback(
    () => client.invalidateQueries({ queryKey: LIBRARY_LIST_KEY }),
    [client]
  );
  return { sessions, outlook, recordings, rows, refreshRecordings };
}

/** Live comes only from the capture store, never from persisted capture state. */
export function useRowLiveness() {
  // Narrow selectors: meters update the store 4x per second while live.
  const active = useCaptureStore((s) => s.status?.active?.meetingId ?? null);
  const liveSession = useCaptureStore((s) => s.liveSession?.sessionId ?? null);
  return useCallback(
    (row: MeetingRow) => {
      if (!active) return false;
      const state = {
        status: { active: { meetingId: active } },
        liveSession: { sessionId: liveSession },
      };
      if (row.kind === 'session')
        return isSessionLive(row.session, state as Parameters<typeof isSessionLive>[1]);
      if (row.kind === 'recording') return active === row.recording.id;
      return false;
    },
    [active, liveSession]
  );
}
