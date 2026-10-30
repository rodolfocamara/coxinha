import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import type { CaptureStatus } from '../meetings/library';

/** Process-local acknowledgements survive routes independently of stale query metadata. */
export const sessionCaptureCache = create<{ bySession: ReadonlyMap<string, string> }>(() => ({
  bySession: new Map(),
}));
export function useAcknowledgedSessionCapture(sessionId: string) {
  return sessionCaptureCache((state) => state.bySession.get(sessionId) ?? null);
}
/** Only an explicit start's successful active result establishes an acknowledgement. */
export async function startSessionCapture(
  sessionId: string,
  micSource: string,
  outputSource: string
) {
  const next = await invoke<CaptureStatus>('library_start_session', {
    sessionId,
    micSource,
    outputSource,
  });
  if (next.active) {
    const meetingId = next.active.meetingId;
    sessionCaptureCache.setState((state) => ({
      bySession: new Map(state.bySession).set(sessionId, meetingId),
    }));
  }
  return next;
}
