import { beforeEach, expect, it, vi } from 'vitest';
import type { ActiveCall } from '../../lib/bindings';
import {
  SILENCE_MS,
  acceptDetectionStatus,
  acknowledgeCallEnded,
  observeCallAudio,
  trackRecordedCall,
  useMeetingDetection,
} from './meetingDetection';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }));
const call = {
  app_name: 'Google Chrome',
  process_name: 'chrome',
  pid: 7,
  is_browser: true,
  detected_at: '2026-11-03T12:00:00Z',
} as ActiveCall;
const playing = (peak: number, paused = false) => ({ paused, output: { peak } });

beforeEach(() => {
  useMeetingDetection.setState({
    enabled: true,
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
  });
  acceptDetectionStatus(
    { enabled: true, supported: true, unavailable: false, calls: [call] },
    true
  );
  trackRecordedCall(call);
});

it('asks whether the call ended after two minutes without the other side, while it is still detected', () => {
  observeCallAudio(playing(0.3), 0);
  observeCallAudio(playing(0), SILENCE_MS - 1);
  expect(useMeetingDetection.getState().callEndedPrompt).toBeNull();
  observeCallAudio(playing(0.004), SILENCE_MS);
  expect(useMeetingDetection.getState()).toMatchObject({
    callEndedPrompt: call,
    endedBy: 'silence',
    trackedCall: call,
  });
});

it('any sound restarts the clock, and "keep recording" waits another two minutes', () => {
  observeCallAudio(playing(0), 0);
  observeCallAudio(playing(0.2), SILENCE_MS - 10);
  observeCallAudio(playing(0), SILENCE_MS + 10);
  expect(useMeetingDetection.getState().callEndedPrompt).toBeNull();
  observeCallAudio(playing(0), 2 * SILENCE_MS);
  expect(useMeetingDetection.getState().endedBy).toBe('silence');
  acknowledgeCallEnded();
  const restarted = useMeetingDetection.getState().lastOutputAt!;
  observeCallAudio(playing(0), restarted + SILENCE_MS - 1);
  expect(useMeetingDetection.getState().callEndedPrompt).toBeNull();
});

it('a paused capture, or one not started from a detected call, never asks', () => {
  observeCallAudio(playing(0, true), 0);
  observeCallAudio(playing(0, true), 10 * SILENCE_MS);
  expect(useMeetingDetection.getState().callEndedPrompt).toBeNull();
  useMeetingDetection.setState({ recordedCallKey: null, trackedCall: null });
  observeCallAudio(playing(0), 0);
  observeCallAudio(playing(0), 10 * SILENCE_MS);
  expect(useMeetingDetection.getState().callEndedPrompt).toBeNull();
});

it('the streams closing still says the call ended', () => {
  acceptDetectionStatus({ enabled: true, supported: true, unavailable: false, calls: [] }, true);
  expect(useMeetingDetection.getState()).toMatchObject({ callEndedPrompt: call, endedBy: 'call' });
});
