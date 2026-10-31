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
export type AutoRecordStatus = {
  settings: AutoRecordSettings;
  binding: { sessionId: string; meetingId: string; call: ActiveCall; keep: boolean } | null;
  stopInMs: number | null;
};

/** `stopAt` is local wall time, so the countdown ticks between backend reads. */
export const useAutoRecord = create<{ status: AutoRecordStatus | null; stopAt: number | null }>(
  () => ({ status: null, stopAt: null })
);

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

/** "Continuar gravando": the end of this call no longer stops the capture. */
export async function keepAutoRecording() {
  accept(await invoke<AutoRecordStatus>('auto_record_keep'));
}

/** The pending automatic stop for the live capture, if one is counting down. */
export function useAutoStop() {
  const binding = useAutoRecord((s) => s.status?.binding ?? null);
  const stopAt = useAutoRecord((s) => s.stopAt);
  return binding && stopAt !== null ? { binding, stopAt } : null;
}

/** Auto-record owns the end of this call: the frontend ended prompt stays quiet. */
export function autoStopsCall(call: ActiveCall | null) {
  const status = useAutoRecord.getState().status;
  const binding = status?.binding;
  return (
    !!call &&
    !!binding &&
    !!status?.settings.stopWhenCallEnds &&
    !binding.keep &&
    binding.call.pid === call.pid &&
    binding.call.process_name === call.process_name
  );
}
