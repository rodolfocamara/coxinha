import { create } from 'zustand';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ActiveCall } from '../../lib/bindings';
import { autoStopsCall, updateAutoRecord, useAutoRecord } from '../capture/autoRecord';

const preference = 'coxinha:meeting-detection';
function enabledPreference() {
  try {
    return localStorage.getItem(preference) !== 'false';
  } catch {
    return true;
  }
}
export type DetectionStatus = {
  enabled: boolean;
  supported: boolean;
  unavailable: boolean;
  calls: ActiveCall[];
};
export const callKey = (call: ActiveCall) => `${call.pid}:${call.process_name}:${call.detected_at}`;

export async function focusMainWindow() {
  try {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    await win.show();
    await win.unminimize();
    await win.setFocus();
  } catch {
    /* Window API unavailable outside desktop runtime or when unmocked in tests. */
  }
}

export const useMeetingDetection = create<{
  enabled: boolean;
  status: DetectionStatus | null;
  failed: boolean;
  recording: boolean;
  dismissed: string[];
  trackedCall: ActiveCall | null;
  recordedCallKey: string | null;
  callEndedPrompt: ActiveCall | null;
  /** Why the prompt shows: the call's streams closed, or nobody spoke for a while. */
  endedBy: 'call' | 'silence' | null;
  /** Last time the recorded call's output carried sound (spec 0114). */
  lastOutputAt: number | null;
  alertedNextCallKeys: string[];
}>(() => ({
  enabled: enabledPreference(),
  status: null,
  failed: false,
  recording: false,
  dismissed: [],
  trackedCall: null,
  recordedCallKey: null,
  callEndedPrompt: null,
  endedBy: null,
  lastOutputAt: null,
  alertedNextCallKeys: [],
}));

export function setDetectionEnabled(enabled: boolean) {
  // ADR 0023: without detection there is nothing to record automatically.
  if (!enabled && useAutoRecord.getState().status?.settings.enabled)
    void updateAutoRecord({ enabled: false }).catch(() => {});
  try {
    localStorage.setItem(preference, String(enabled));
  } catch {
    /* Session preference still applies. */
  }
  useMeetingDetection.setState({
    enabled,
    status: null,
    dismissed: [],
    trackedCall: null,
    recordedCallKey: null,
    callEndedPrompt: null,
    alertedNextCallKeys: [],
  });
}

export function dismissCall(key: string) {
  useMeetingDetection.setState((s) => ({
    dismissed: [...s.dismissed.filter((k) => k !== key), key].slice(-64),
  }));
}

export function trackRecordedCall(call: ActiveCall) {
  const key = callKey(call);
  useMeetingDetection.setState((s) => ({
    recording: true,
    trackedCall: call,
    recordedCallKey: key,
    callEndedPrompt: null,
    endedBy: null,
    lastOutputAt: null,
    dismissed: [...s.dismissed.filter((k) => k !== key), key].slice(-64),
  }));
}

export function acknowledgeCallEnded() {
  // "Continuar gravando" restarts the silence clock instead of asking again at once.
  useMeetingDetection.setState({ callEndedPrompt: null, endedBy: null, lastOutputAt: Date.now() });
}

/** Two minutes without the other side's audio is a second sign the call is over. */
export const SILENCE_MS = 120_000;
const OUTPUT_FLOOR = 0.01;

/**
 * Spec 0114: a browser can keep its microphone stream after the owner leaves
 * a meeting, so stream presence alone may never end the call. While a
 * detected call is recorded, a long silence on the output track asks too.
 */
export function observeCallAudio(
  active: { paused: boolean; output: { peak: number } } | null | undefined,
  now = Date.now()
) {
  let shouldFocus = false;
  useMeetingDetection.setState((s) => {
    if (!active || active.paused || !s.recordedCallKey || !s.enabled)
      return s.lastOutputAt === null ? s : { lastOutputAt: null };
    if (s.lastOutputAt === null || active.output.peak >= OUTPUT_FLOOR) return { lastOutputAt: now };
    // The backend only stops on the call's end, so silence still asks (spec 0118).
    if (s.callEndedPrompt || !s.trackedCall || now - s.lastOutputAt < SILENCE_MS) return s;
    shouldFocus = true;
    return { callEndedPrompt: s.trackedCall, endedBy: 'silence' as const };
  });
  if (shouldFocus) void focusMainWindow();
}

export function acceptDetectionStatus(status: DetectionStatus, recording: boolean) {
  const keys = new Set(status.calls.map(callKey));
  let shouldFocus = false;
  useMeetingDetection.setState((s) => {
    const dismissed = s.dismissed.filter((k) => keys.has(k));
    const alertedNextCallKeys = s.alertedNextCallKeys.filter((k) => keys.has(k));
    if (!recording || status.unavailable || !s.enabled) {
      return {
        status,
        recording,
        failed: false,
        dismissed,
        trackedCall: null,
        recordedCallKey: null,
        callEndedPrompt: null,
        endedBy: null,
        alertedNextCallKeys: [],
      };
    }
    let trackedCall = s.trackedCall;
    let recordedCallKey = s.recordedCallKey;
    let callEndedPrompt = s.callEndedPrompt;
    let endedBy = s.endedBy;
    if (!recordedCallKey && status.calls.length > 0) {
      trackedCall = status.calls[0];
      recordedCallKey = callKey(status.calls[0]);
      callEndedPrompt = null;
    } else if (trackedCall && !keys.has(callKey(trackedCall))) {
      // With automatic stop on, the strip shows the backend countdown instead.
      if (!autoStopsCall(trackedCall)) {
        callEndedPrompt = trackedCall;
        endedBy = 'call';
        shouldFocus = true;
      }
      trackedCall = null;
    }
    const nextCalls = recordedCallKey
      ? status.calls.filter(
          (c) => callKey(c) !== recordedCallKey && !dismissed.includes(callKey(c))
        )
      : [];
    const nextAlerted = [...alertedNextCallKeys];
    for (const nextCall of nextCalls) {
      const k = callKey(nextCall);
      if (!nextAlerted.includes(k)) {
        nextAlerted.push(k);
        shouldFocus = true;
      }
    }
    if (nextCalls.length > 0) {
      callEndedPrompt = null;
    }
    return {
      status,
      recording,
      failed: false,
      dismissed,
      trackedCall,
      recordedCallKey,
      callEndedPrompt,
      endedBy: callEndedPrompt ? endedBy : null,
      alertedNextCallKeys: nextAlerted,
    };
  });
  if (shouldFocus) {
    void focusMainWindow();
  }
}
