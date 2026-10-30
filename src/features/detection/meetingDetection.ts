import { create } from 'zustand';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ActiveCall } from '../../lib/bindings';

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
  alertedNextCallKeys: [],
}));

export function setDetectionEnabled(enabled: boolean) {
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
    dismissed: [...s.dismissed.filter((k) => k !== key), key].slice(-64),
  }));
}

export function acknowledgeCallEnded() {
  useMeetingDetection.setState({ callEndedPrompt: null });
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
        alertedNextCallKeys: [],
      };
    }
    let trackedCall = s.trackedCall;
    let recordedCallKey = s.recordedCallKey;
    let callEndedPrompt = s.callEndedPrompt;
    if (!recordedCallKey && status.calls.length > 0) {
      trackedCall = status.calls[0];
      recordedCallKey = callKey(status.calls[0]);
      callEndedPrompt = null;
    } else if (trackedCall && !keys.has(callKey(trackedCall))) {
      callEndedPrompt = trackedCall;
      trackedCall = null;
      shouldFocus = true;
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
      alertedNextCallKeys: nextAlerted,
    };
  });
  if (shouldFocus) {
    void focusMainWindow();
  }
}
