import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import type { ActiveCall } from '../../lib/bindings';
import { useDirectCapture } from '../detection/directCapture';
import { acceptDetectionStatus, callKey, useMeetingDetection } from '../detection/meetingDetection';
import { initialCaptureState, useCaptureStore } from './captureStore';
import { RecorderStrip, formatElapsed } from './RecorderStrip';

const { navigate, createSession, library, windowBridge } = vi.hoisted(() => ({
  navigate: vi.fn(),
  createSession: vi.fn(),
  library: {
    available: () => true,
    status: vi.fn(),
    start: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    sources: vi.fn(),
  },
  windowBridge: {
    show: vi.fn(async () => undefined),
    unminimize: vi.fn(async () => undefined),
    setFocus: vi.fn(async () => undefined),
  },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => windowBridge }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../components/AppShell/WindowChrome', () => ({
  WindowChrome: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../sessions/sessions', async () => {
  const { create } = await import('zustand');
  return {
    sessions: { create: createSession },
    sessionListCache: create(() => ({ data: [], isError: false, updatedAt: 0 })),
  };
});
vi.mock('../meetings/library', () => ({ library }));

const call = {
  app_name: 'Microsoft Teams',
  process_name: 'teams',
  pid: 42,
  is_browser: false,
  detected_at: '2026-10-25T22:00:00Z',
} as ActiveCall;
const detection = { enabled: true, supported: true, unavailable: false, calls: [call] };
const meter = { peak: 0.2, lastBlockMs: 10, error: null };
const live = (paused = false) => ({
  active: { meetingId: 'm1', paused, elapsedMs: 724_000, mic: meter, output: meter },
  error: null,
});
const idle = { active: null, error: null };

beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.clearAllMocks();
  localStorage.clear();
  useCaptureStore.setState({ ...initialCaptureState });
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
  library.sources.mockResolvedValue([
    { name: 'mic', description: 'Mic', monitor: false, is_default: true },
    { name: 'output', description: 'Out', monitor: true, is_default: true },
  ]);
  library.stop.mockResolvedValue(idle);
  library.pause.mockResolvedValue(live(true));
  createSession.mockResolvedValue({ id: 'new-session' });
  vi.mocked(invoke).mockResolvedValue(live());
});
afterEach(() => cleanup());

it('formats elapsed time with hours only when needed', () => {
  expect(formatElapsed(724_000)).toBe('12:04');
  expect(formatElapsed(3_725_000)).toBe('1:02:05');
});

it('idle shows a quiet ready line and no capture controls', () => {
  render(<RecorderStrip />);
  expect(screen.getByText(/Ready to record/)).toBeVisible();
  expect(screen.queryByRole('button', { name: /Stop and save/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Pause/ })).toBeNull();
});

it('detection and dismissal never start capture; dismissal survives remount', () => {
  acceptDetectionStatus(detection, false);
  const view = render(<RecorderStrip />);
  expect(screen.getByRole('status')).toHaveTextContent('Call in Microsoft Teams');
  fireEvent.click(screen.getByRole('button', { name: 'Ignore' }));
  expect(screen.queryByText('Call in Microsoft Teams')).toBeNull();
  view.unmount();
  render(<RecorderStrip />);
  expect(screen.queryByText('Call in Microsoft Teams')).toBeNull();
  expect(createSession).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});

it('one click records a detected call with default devices, without navigating', async () => {
  acceptDetectionStatus(detection, false);
  render(<RecorderStrip />);
  fireEvent.click(screen.getByRole('button', { name: 'Record' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('library_start_session', {
      sessionId: 'new-session',
      micSource: 'mic',
      outputSource: 'output',
    })
  );
  expect(createSession).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
  expect(useMeetingDetection.getState().dismissed).toContain(callKey(call));
  expect(await screen.findByText('Recording 12:04')).toBeVisible();
  expect(screen.getByRole('button', { name: /Meeting in Microsoft Teams/ })).toBeVisible();
});

it('recording exposes pause and stop, and paused offers resume', async () => {
  useCaptureStore.setState({ status: live() });
  render(<RecorderStrip />);
  expect(screen.getByRole('status')).toHaveTextContent('Recording 12:04');
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(library.pause).toHaveBeenCalledWith(true));
  expect(await screen.findByText('Paused 12:04')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Stop and save' }));
  await waitFor(() => expect(library.stop).toHaveBeenCalledOnce());
  expect(await screen.findByText(/Ready to record/)).toBeVisible();
});

it('prompts to stop when the recorded call ends, and focuses the window', async () => {
  useCaptureStore.setState({ status: live() });
  acceptDetectionStatus(detection, true);
  render(<RecorderStrip />);
  act(() => acceptDetectionStatus({ ...detection, calls: [] }, true));
  await waitFor(() => expect(windowBridge.setFocus).toHaveBeenCalledOnce());
  expect(screen.getByRole('alert')).toHaveTextContent('The Microsoft Teams call ended');
  fireEvent.click(screen.getByRole('button', { name: 'Stop and save' }));
  await waitFor(() => expect(library.stop).toHaveBeenCalledOnce());
});

it('offers to record a back-to-back call as a new meeting', async () => {
  useCaptureStore.setState({ status: live() });
  acceptDetectionStatus(detection, true);
  render(<RecorderStrip />);
  const second = { ...call, detected_at: '2026-10-25T23:00:00Z' };
  act(() => acceptDetectionStatus({ ...detection, calls: [second] }, true));
  expect(await screen.findByRole('alert')).toHaveTextContent('New call in Microsoft Teams');
  library.stop.mockImplementation(async () => {
    useCaptureStore.setState({ status: idle });
    return idle;
  });
  fireEvent.click(screen.getByRole('button', { name: 'Record the new one' }));
  await waitFor(() => expect(library.stop).toHaveBeenCalledOnce());
  await waitFor(() => expect(createSession).toHaveBeenCalledOnce());
});

it('shows background processing with its phase', () => {
  useCaptureStore.setState({
    status: {
      active: null,
      error: null,
      processing: { meetingId: 'm1', job: 'j', phase: 'inference' },
    },
  });
  render(<RecorderStrip />);
  expect(screen.getByRole('status')).toHaveTextContent('Transcribing');
  expect(screen.getByText('continues in the background')).toBeVisible();
});

it('shows an interrupted capture once and lets the user dismiss it', () => {
  useCaptureStore.setState({ status: { active: null, error: 'capture interrupted' } });
  render(<RecorderStrip />);
  expect(screen.getByRole('alert')).toHaveTextContent('Recording interrupted');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
  expect(screen.queryByText('Recording interrupted')).toBeNull();
});

it('explains a failed start without devices', () => {
  useCaptureStore.setState({ failure: 'devicesMissing' });
  render(<RecorderStrip />);
  expect(screen.getByRole('alert')).toHaveTextContent('No microphone or computer audio found.');
});
