import { create } from 'zustand';
import type { ActiveCall } from '../../lib/bindings';
import { library } from '../meetings/library';
import { sessions, type SessionInput } from '../sessions/sessions';
import { loadDevices, startCapture, stopCapture } from '../capture/captureActions';
import { useCaptureStore } from '../capture/captureStore';
import type { CalendarEvent } from '../agenda/calendar';
import { callKey, trackRecordedCall, useMeetingDetection } from './meetingDetection';

type Failure = 'devicesMissing' | 'callEnded' | 'captureBusy' | 'startFailed';
type Attempt = {
  key: string;
  sessionId?: string;
  input: SessionInput;
  event?: CalendarEvent;
};
/** Process-local: remounts cannot duplicate an in-flight explicit consent. */
export const useDirectCapture = create<{
  busy: boolean;
  attempt: Attempt | null;
  error: Failure | null;
  receipt: { sessionId: string; title: string; metadataFailed: boolean } | null;
}>(() => ({ busy: false, attempt: null, error: null, receipt: null }));
function stillDetected(key: string) {
  const s = useMeetingDetection.getState();
  return (
    s.enabled &&
    !s.failed &&
    !s.status?.unavailable &&
    s.status?.calls.some((c) => callKey(c) === key)
  );
}
export function invitedPeople(event: CalendarEvent) {
  const people = [...event.attendees, ...(event.organizer ? [event.organizer] : [])];
  return people.filter(
    (p, i) =>
      people.findIndex((other) =>
        p.email && other.email
          ? p.email.toLowerCase() === other.email.toLowerCase()
          : !p.email &&
            !other.email &&
            p.name.trim().toLowerCase() === other.name.trim().toLowerCase()
      ) === i
  );
}
export async function recordDetectedCall(call: ActiveCall, title: string, event?: CalendarEvent) {
  const state = useDirectCapture.getState();
  if (state.busy || !title.trim()) return;
  const key = callKey(call);
  if (useMeetingDetection.getState().dismissed.includes(key)) return;
  const attempt =
    state.attempt?.key === key && state.attempt.sessionId
      ? state.attempt
      : {
          key,
          event,
          input: {
            title: event?.title.trim() || title.trim(),
            starts_at: event ? new Date(event.startsAt).toISOString().slice(0, 19) + 'Z' : null,
            ends_at: event ? new Date(event.endsAt).toISOString().slice(0, 19) + 'Z' : null,
            status: 'planned' as const,
          },
        };
  useDirectCapture.setState({ busy: true, error: null, attempt, receipt: null });
  let failure: Failure = 'startFailed';
  try {
    if (!stillDetected(key)) {
      failure = 'callEnded';
      throw new Error(failure);
    }
    const { status, reachable } = useCaptureStore.getState();
    if (!reachable || status?.active || status?.processing) {
      failure = 'captureBusy';
      throw new Error(failure);
    }
    const devices = await loadDevices();
    if (!devices?.mic || !devices.output) {
      failure = 'devicesMissing';
      throw new Error(failure);
    }
    if (!stillDetected(key)) {
      failure = 'callEnded';
      throw new Error(failure);
    }
    if (!attempt.sessionId) {
      attempt.sessionId = (await sessions.create(attempt.input)).id;
      useDirectCapture.setState({ attempt: { ...attempt } });
    }
    if (!stillDetected(key)) {
      failure = 'callEnded';
      throw new Error(failure);
    }
    const next = await startCapture({ sessionId: attempt.sessionId, title: attempt.input.title });
    if (!next?.active) throw new Error('Capture was not acknowledged');
    // Only the explicit start acknowledgement grants ownership. Metadata errors
    // below cannot retry or invalidate a successfully started capture.
    trackRecordedCall(call);
    const receipt = {
      sessionId: attempt.sessionId,
      title: attempt.input.title,
      metadataFailed: false,
    };
    if (attempt.event) {
      try {
        await library.setParticipantContext(next.active.meetingId, invitedPeople(attempt.event));
      } catch {
        receipt.metadataFailed = true;
      }
    }
    useDirectCapture.setState({ receipt, attempt: null });
  } catch {
    useDirectCapture.setState({ error: failure });
  } finally {
    useDirectCapture.setState({ busy: false });
    // Refresh is independent of capture success and cannot turn into a retry.
    window.dispatchEvent(new Event('coxinha:sessions-changed'));
  }
}

export async function stopDetectedCallRecording() {
  if (useDirectCapture.getState().busy) return;
  useDirectCapture.setState({ busy: true, error: null });
  try {
    if (!(await stopCapture())) throw new Error('stop failed');
    useDirectCapture.setState({ receipt: null, attempt: null });
    useMeetingDetection.setState({
      recording: false,
      trackedCall: null,
      recordedCallKey: null,
      callEndedPrompt: null,
      alertedNextCallKeys: [],
    });
    window.dispatchEvent(new Event('coxinha:sessions-changed'));
  } catch {
    useDirectCapture.setState({ error: 'startFailed' });
  } finally {
    useDirectCapture.setState({ busy: false });
  }
}

export async function switchToDetectedCall(call: ActiveCall, title: string, event?: CalendarEvent) {
  if (useDirectCapture.getState().busy || !title.trim()) return;
  useDirectCapture.setState({ busy: true, error: null });
  try {
    if (!(await stopCapture())) throw new Error('stop failed');
    useDirectCapture.setState({ receipt: null, attempt: null, busy: false });
    useMeetingDetection.setState({
      recording: false,
      trackedCall: null,
      recordedCallKey: null,
      callEndedPrompt: null,
      alertedNextCallKeys: [],
    });
  } catch {
    useDirectCapture.setState({ error: 'startFailed', busy: false });
    return;
  }
  await recordDetectedCall(call, title, event);
}
