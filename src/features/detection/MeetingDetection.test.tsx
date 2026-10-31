import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { useDirectCapture } from './directCapture';
import { DetectionSettings } from './DetectionSettings';
import { CallDetectionController } from './CallDetectionController';
import {
  acceptDetectionStatus,
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
it('exposes a persisted settings switch and the unavailable state', () => {
  acceptDetectionStatus({ ...status, unavailable: true }, false);
  render(<DetectionSettings />);
  expect(screen.getByRole('status')).toHaveTextContent('unavailable');
  fireEvent.click(screen.getByRole('checkbox'));
  expect(localStorage.getItem('coxinha:meeting-detection')).toBe('false');
  expect(useMeetingDetection.getState().enabled).toBe(false);
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
