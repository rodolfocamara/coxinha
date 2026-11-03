import { create } from 'zustand';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ActiveCall } from '../../lib/bindings';

/** Spec 0097 / ADR 0023: persisted by the backend, which also runs the policy. */
export type AutoRecordSettings = {
  enabled: boolean;
  stopWhenCallEnds: boolean;
  micSource: string | null;
  outputSource: string | null;
};
/** Spec 0118: the live capture and the calls it follows, whoever started it. */
export type AutoRecordBinding = {
  /** Set when automatic recording started the capture. */
  sessionId: string | null;
  meetingId: string;
  calls: ActiveCall[];
  keep: boolean;
};
export type AutoRecordStatus = {
  settings: AutoRecordSettings;
  binding: AutoRecordBinding | null;
  stopInMs: number | null;
  /** The last capture that stopped with its call. */
  ended: { meetingId: string; app: string } | null;
};

/** `stopAt` is local wall time, so the countdown ticks between backend reads. */
export const useAutoRecord = create<{
  status: AutoRecordStatus | null;
  stopAt: number | null;
  /** The ended line the owner closed. */
  dismissedEnded: string | null;
}>(() => ({ status: null, stopAt: null, dismissedEnded: null }));

function accept(status: AutoRecordStatus) {
  useAutoRecord.setState({
    status,
    stopAt: status.stopInMs === null ? null : Date.now() + status.stopInMs,
  });
}

export async function refreshAutoRecord() {
  if (!isTauri()) return;
  try {
    accept(await invoke<AutoRecordStatus>('auto_record_status'));
  } catch {
    /* Older backend or unavailable: auto-record simply stays hidden. */
  }
}

export async function updateAutoRecord(next: Partial<AutoRecordSettings>) {
  const current = useAutoRecord.getState().status?.settings;
  if (!current) return;
  accept(await invoke<AutoRecordStatus>('set_auto_record', { settings: { ...current, ...next } }));
}

/** "Continuar gravando": the end of these calls no longer stops the capture. */
export async function keepAutoRecording() {
  accept(await invoke<AutoRecordStatus>('auto_record_keep'));
}

/** The pending automatic stop for the live capture, if one is counting down. */
export function useAutoStop() {
  const binding = useAutoRecord((s) => s.status?.binding ?? null);
  const stopAt = useAutoRecord((s) => s.stopAt);
  return binding && stopAt !== null ? { binding, stopAt } : null;
}

/** The backend stops with this call (spec 0118): the ended prompt stays quiet. */
export function autoStopsCall(call: ActiveCall | null) {
  const status = useAutoRecord.getState().status;
  const binding = status?.binding;
  return (
    !!call &&
    !!binding &&
    !!status?.settings.stopWhenCallEnds &&
    !binding.keep &&
    binding.calls.some((c) => c.pid === call.pid && c.process_name === call.process_name)
  );
}

/** Spec 0118 P3: the recording that stopped with its call, until dismissed. */
export function useEndedWithCall() {
  return useAutoRecord((s) =>
    s.status?.ended && s.status.ended.meetingId !== s.dismissedEnded ? s.status.ended : null
  );
}

export function dismissEndedWithCall() {
  useAutoRecord.setState((s) => ({ dismissedEnded: s.status?.ended?.meetingId ?? null }));
}
