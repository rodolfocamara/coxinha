import { invoke } from '@tauri-apps/api/core';
import { library, type CaptureStatus } from '../meetings/library';
import { selectDevice } from '../meetings/useCaptureDevices';
import { sessions } from '../sessions/sessions';
import { useCaptureStore, type CaptureFailure } from './captureStore';
import { updateAutoRecord } from './autoRecord';

const SESSIONS_CHANGED = 'coxinha:sessions-changed';
const MIC_PREF = 'coxinha:capture-mic';
const OUTPUT_PREF = 'coxinha:capture-output';

function readPref(key: string) {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* The choice still applies for this run. */
  }
}

function accept(status: CaptureStatus) {
  useCaptureStore.setState((s) => ({
    status,
    reachable: true,
    liveSession: status.active ? s.liveSession : null,
    // A new error replaces a dismissed one; a cleared error forgets the dismissal.
    dismissedError: status.error ? s.dismissedError : null,
  }));
}

/** Reads `library_status`. Only the controller and the actions below call it. */
export async function refreshCapture() {
  if (!library.available()) return;
  try {
    accept(await library.status());
    if (useCaptureStore.getState().failure === 'status')
      useCaptureStore.setState({ failure: null });
  } catch {
    useCaptureStore.setState({ reachable: false, failure: 'status' });
  }
}

/** Discovers sources and resolves the remembered or default devices. Never starts capture. */
export async function loadDevices(reset = false) {
  try {
    const sources = await library.sources();
    const s = useCaptureStore.getState();
    const mic = selectDevice(sources, reset ? '' : s.mic || readPref(MIC_PREF), false, reset);
    const output = selectDevice(
      sources,
      reset ? '' : s.output || readPref(OUTPUT_PREF),
      true,
      reset
    );
    useCaptureStore.setState({ sources, mic, output });
    return { mic, output };
  } catch {
    useCaptureStore.setState({ failure: 'devices' });
    return null;
  }
}

export function chooseDevices(next: { mic?: string; output?: string }) {
  if (next.mic !== undefined) writePref(MIC_PREF, next.mic);
  if (next.output !== undefined) writePref(OUTPUT_PREF, next.output);
  useCaptureStore.setState(next);
  // The backend starts automatic captures without the webview (spec 0097).
  const devices = {
    ...(next.mic !== undefined && { micSource: next.mic || null }),
    ...(next.output !== undefined && { outputSource: next.output || null }),
  };
  void updateAutoRecord(devices).catch(() => {});
}

async function run(
  busy: 'start' | 'pause' | 'stop',
  failure: CaptureFailure,
  action: () => Promise<CaptureStatus>
) {
  if (useCaptureStore.getState().busy) return null;
  useCaptureStore.setState({ busy, failure: null });
  try {
    const status = await action();
    accept(status);
    return status;
  } catch (error) {
    useCaptureStore.setState({ failure });
    throw error;
  } finally {
    useCaptureStore.setState({ busy: null });
    window.dispatchEvent(new Event(SESSIONS_CHANGED));
  }
}

export type StartRequest = { sessionId: string; title: string } | { title: string };

/**
 * Starts a capture for a meeting session, or a standalone one. Devices come
 * from the store (remembered choice or system default); the strip and the
 * settings screen are the only places that change them.
 */
export async function startCapture(request: StartRequest) {
  const current = useCaptureStore.getState();
  if (current.busy) return null;
  if (current.status?.active || current.status?.processing) {
    useCaptureStore.setState({ failure: 'captureBusy' });
    return null;
  }
  const devices = current.mic && current.output ? current : await loadDevices();
  if (!devices?.mic || !devices.output) {
    useCaptureStore.setState({ failure: 'devicesMissing' });
    return null;
  }
  const status = await run('start', 'start', () =>
    'sessionId' in request
      ? invoke<CaptureStatus>('library_start_session', {
          sessionId: request.sessionId,
          micSource: devices.mic,
          outputSource: devices.output,
        })
      : library.start(request.title, devices.mic, devices.output)
  ).catch(() => null);
  if (status?.active) {
    useCaptureStore.setState({
      liveSession: {
        sessionId: 'sessionId' in request ? request.sessionId : null,
        title: request.title,
      },
    });
  }
  return status;
}

export function pauseCapture(paused: boolean) {
  return run('pause', 'pause', () => library.pause(paused)).catch(() => null);
}

export async function stopCapture() {
  const status = await run('stop', 'stop', () => library.stop()).catch(() => null);
  if (status && !status.active) useCaptureStore.setState({ liveSession: null });
  return status;
}

export function dismissCaptureError() {
  useCaptureStore.setState((s) => ({ dismissedError: s.status?.error ?? null, failure: null }));
}

/**
 * Rail button and global shortcut: stop when live, otherwise create a meeting
 * session for the capture so it gets notes and shows up in Reuniões.
 */
export async function toggleCapture(title: string) {
  const { status, busy } = useCaptureStore.getState();
  if (busy) return null;
  if (status?.active) return stopCapture();
  const now = new Date().toISOString().slice(0, 19) + 'Z';
  const session = await sessions
    .create({ title, starts_at: now, ends_at: null, status: 'active' })
    .catch(() => null);
  return startCapture(session ? { sessionId: session.id, title } : { title });
}
