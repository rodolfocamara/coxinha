import { create } from 'zustand';
import type { CaptureStatus, Source } from '../meetings/library';
import type { Session } from '../sessions/sessions';

export type CaptureBusy = 'start' | 'pause' | 'stop' | null;
export type CaptureFailure =
  | 'status'
  | 'start'
  | 'pause'
  | 'stop'
  | 'devices'
  | 'devicesMissing'
  | 'captureBusy'
  | null;

/**
 * Single source of capture truth for the UI (spec 0096 P1). Only
 * `CaptureController` and `captureActions` write here; components read
 * through the selectors below.
 */
export type CaptureState = {
  status: CaptureStatus | null;
  /** False after `library_status` failed: the library cannot be assumed idle. */
  reachable: boolean;
  busy: CaptureBusy;
  failure: CaptureFailure;
  sources: Source[];
  mic: string;
  output: string;
  /** What the live capture belongs to, known from the start request. */
  liveSession: { sessionId: string | null; title: string } | null;
  /** Backend errors are sticky until the next start; the user can hide one. */
  dismissedError: string | null;
};

export const initialCaptureState: CaptureState = {
  status: null,
  reachable: true,
  busy: null,
  failure: null,
  sources: [],
  mic: '',
  output: '',
  liveSession: null,
  dismissedError: null,
};

export const useCaptureStore = create<CaptureState>(() => ({ ...initialCaptureState }));

export type CapturePhase = 'idle' | 'recording' | 'paused' | 'processing';

export function capturePhase(status: CaptureStatus | null): CapturePhase {
  if (status?.active) return status.active.paused ? 'paused' : 'recording';
  if (status?.processing) return 'processing';
  return 'idle';
}

export const useCapturePhase = () => useCaptureStore((s) => capturePhase(s.status));
export const useLiveMeetingId = () => useCaptureStore((s) => s.status?.active?.meetingId ?? null);

type LiveCandidate = Pick<Session, 'id' | 'meeting_id'> & {
  live?: { paused: boolean } | null;
};

/** Live means a capture is running right now; persisted capture state never counts. */
export function isSessionLive(session: LiveCandidate, state: CaptureState) {
  const active = state.status?.active;
  if (!active) return false;
  if (session.meeting_id && session.meeting_id === active.meetingId) return true;
  return !!state.liveSession?.sessionId && state.liveSession.sessionId === session.id;
}

export function useIsLive(session: LiveCandidate | null | undefined) {
  return useCaptureStore((s) => (session ? isSessionLive(session, s) : false));
}

export function useIsLivePaused() {
  return useCaptureStore((s) => !!s.status?.active?.paused);
}
