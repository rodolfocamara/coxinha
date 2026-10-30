import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { useDirectCapture } from './directCapture';
import { MeetingReminder } from './MeetingReminder';
import { DetectionSettings } from './DetectionSettings';
import { CallDetectionController } from './CallDetectionController';
import {
  acceptDetectionStatus,
  callKey,
  setDetectionEnabled,
  useMeetingDetection,
} from './meetingDetection';
import type { ActiveCall } from '../../lib/bindings';

const { navigate, createSession, refresh, stopCapture, windowBridge } = vi.hoisted(() => ({
  navigate: vi.fn(),
  createSession: vi.fn(),
  refresh: vi.fn(),
  stopCapture: vi.fn(),
  windowBridge: {
    show: vi.fn(async () => undefined),
    unminimize: vi.fn(async () => undefined),
    setFocus: vi.fn(async () => undefined),
  },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => windowBridge }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('../sessions/sessions', () => ({
  sessions: { create: createSession },
  useRefreshSessions: () => refresh,
  useSessions: () => ({ data: [], isError: false, refetch: vi.fn() }),
}));
vi.mock('../meetings/library', () => ({
  library: {
    status: async () => ({ active: null }),
    stop: stopCapture,
    sources: async () => [
      { name: 'mic', monitor: false, is_default: true },
      { name: 'output', monitor: true, is_default: true },
    ],
  },
}));
const call = {
  app_name: 'Microsoft Teams',
  process_name: 'teams',
  pid: 42,
  is_browser: false,
  detected_at: '2026-10-25T22:00:00Z',
} as ActiveCall;
const status = { enabled: true, supported: true, unavailable: false, calls: [call] };
beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.clearAllMocks();
  localStorage.clear();
  useMeetingDetection.setState({
    enabled: true,
    status: null,
    failed: false,
    recording: false,
    dismissed: [],
    trackedCall: null,
    recordedCallKey: null,
    callEndedPrompt: null,
    alertedNextCallKeys: [],
  });
  useDirectCapture.setState({ busy: false, attempt: null, error: null, receipt: null });
  navigate.mockResolvedValue(undefined);
  refresh.mockResolvedValue(undefined);
  stopCapture.mockResolvedValue(undefined);
  createSession.mockResolvedValue({ id: 'new-session' });
  vi.mocked(invoke).mockResolvedValue(status);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('detection and dismissal never start capture or create a session; dismissal survives remount', () => {
  acceptDetectionStatus(status, false);
  const view = render(<MeetingReminder />);
  expect(screen.getByRole('status')).toHaveTextContent('Record it?');
  fireEvent.click(screen.getByRole('button', { name: 'Ignore this call' }));
  expect(screen.queryByRole('status')).toBeNull();
  view.unmount();
  render(<MeetingReminder />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(createSession).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
  act(() => acceptDetectionStatus({ ...status, calls: [] }, false));
  act(() =>
    acceptDetectionStatus({ ...status, calls: [{ ...call, detected_at: 'later' }] }, false)
  );
  expect(screen.getByRole('status')).toBeVisible();
});
it('one confirmation creates and starts with defaults without navigating', async () => {
  acceptDetectionStatus(status, false);
  vi.mocked(invoke).mockResolvedValue({ active: { meetingId: 'new-recording' } });
  render(<MeetingReminder />);
  expect(createSession).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Yes, record' }));
  expect(await screen.findByText('Recording started: Meeting in Microsoft Teams')).toBeVisible();
  expect(createSession).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith('library_start_session', {
    sessionId: 'new-session',
    micSource: 'mic',
    outputSource: 'output',
  });
  expect(navigate).not.toHaveBeenCalled();
  expect(useMeetingDetection.getState().dismissed).toContain(callKey(call));
});
it('suppresses reminders while recording or unavailable and exposes a persisted settings switch', () => {
  acceptDetectionStatus(status, true);
  const view = render(
    <>
      <MeetingReminder />
      <DetectionSettings />
    </>
  );
  expect(screen.queryByRole('button', { name: 'Yes, record' })).toBeNull();
  act(() => acceptDetectionStatus({ ...status, unavailable: true }, false));
  expect(screen.getByRole('status')).toHaveTextContent('unavailable');
  fireEvent.click(screen.getByRole('checkbox'));
  expect(localStorage.getItem('coxinha:meeting-detection')).toBe('false');
  expect(useMeetingDetection.getState().enabled).toBe(false);
  view.unmount();
});
it('focuses the window and prompts to stop when the recorded call ends', async () => {
  acceptDetectionStatus(status, true);
  render(<MeetingReminder />);
  expect(screen.queryByRole('alert')).toBeNull();

  act(() => acceptDetectionStatus({ ...status, calls: [] }, true));

  await waitFor(() => expect(windowBridge.setFocus).toHaveBeenCalledOnce());
  expect(windowBridge.show).toHaveBeenCalledOnce();
  expect(windowBridge.unminimize).toHaveBeenCalledOnce();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The call in Microsoft Teams appears to have ended, but Coxinha is still recording.'
  );

  fireEvent.click(screen.getByRole('button', { name: 'Stop and save' }));
  await waitFor(() => expect(stopCapture).toHaveBeenCalledOnce());
  expect(screen.queryByRole('alert')).toBeNull();
});
it('alerts and can start a new meeting when a back-to-back call begins while recording', async () => {
  acceptDetectionStatus(status, true);
  vi.mocked(invoke).mockResolvedValue({ active: { meetingId: 'second-recording' } });
  render(<MeetingReminder />);

  const secondCall: ActiveCall = {
    ...call,
    detected_at: '2026-10-25T23:00:00Z',
  };
  act(() => acceptDetectionStatus({ ...status, calls: [secondCall] }, true));

  await waitFor(() => expect(windowBridge.setFocus).toHaveBeenCalledOnce());
  expect(screen.getByRole('alert')).toHaveTextContent(
    'New call detected in Microsoft Teams while still recording. Separate into a new meeting?'
  );

  fireEvent.click(screen.getByRole('button', { name: 'Start new meeting' }));
  await waitFor(() => expect(stopCapture).toHaveBeenCalledOnce());
  await waitFor(() => expect(createSession).toHaveBeenCalledOnce());
  expect(invoke).toHaveBeenCalledWith('library_start_session', {
    sessionId: 'new-session',
    micSource: 'mic',
    outputSource: 'output',
  });
});
it('serializes delayed enable then disable and does not publish an old response', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(invoke)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    )
    .mockResolvedValue({ ...status, enabled: false, calls: [] });
  render(<CallDetectionController />);
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('set_call_detection_enabled', { enabled: true })
  );
  act(() => setDetectionEnabled(false));
  await act(async () => {
    resolve(status);
  });
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('set_call_detection_enabled', { enabled: false })
  );
  expect(useMeetingDetection.getState().status?.calls).toEqual([]);
  expect(invoke).not.toHaveBeenCalledWith('call_detection_status');
});
it('controller reports service failure without starting capture', async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'call_detection_status') throw new Error('offline');
    return { ...status, calls: [] };
  });
  render(<CallDetectionController />);
  await waitFor(() => expect(useMeetingDetection.getState().failed).toBe(true));
  expect(createSession).not.toHaveBeenCalled();
});
