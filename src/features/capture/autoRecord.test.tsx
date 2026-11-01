import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import type { ActiveCall } from '../../lib/bindings';
import { acceptDetectionStatus, useMeetingDetection } from '../detection/meetingDetection';
import { AutoRecordSettings } from '../detection/AutoRecordSettings';
import { useAutoRecord, type AutoRecordStatus } from './autoRecord';
import { chooseDevices } from './captureActions';
import { initialCaptureState, useCaptureStore } from './captureStore';
import { RecorderStrip } from './RecorderStrip';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ show: vi.fn(), unminimize: vi.fn(), setFocus: vi.fn() }),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../components/AppShell/WindowChrome', () => ({
  WindowChrome: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../sessions/sessions', async () => {
  const { create } = await import('zustand');
  return {
    sessions: { create: vi.fn() },
    sessionListCache: create(() => ({ data: [], isError: false, updatedAt: 0 })),
  };
});

const call = {
  app_name: 'Microsoft Teams',
  process_name: 'teams',
  pid: 42,
  is_browser: false,
  detected_at: '2026-10-31T13:00:00Z',
} as ActiveCall;
const meter = { peak: 0.2, lastBlockMs: 10, error: null };
const settings = { enabled: true, stopWhenCallEnds: true, micSource: null, outputSource: null };
const status = (over: Partial<AutoRecordStatus> = {}): AutoRecordStatus => ({
  settings,
  binding: { sessionId: 's1', meetingId: 'm1', call, keep: false },
  stopInMs: null,
  ...over,
});

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
  vi.clearAllMocks();
  localStorage.clear();
  useCaptureStore.setState({
    ...initialCaptureState,
    status: {
      active: { meetingId: 'm1', paused: false, elapsedMs: 600_000, mic: meter, output: meter },
      error: null,
    },
  });
  useAutoRecord.setState({ status: null, stopAt: null });
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
});
afterEach(() => cleanup());

it('counts down the automatic stop and lets the user keep recording', async () => {
  useAutoRecord.setState({ status: status({ stopInMs: 18_000 }), stopAt: Date.now() + 18_000 });
  vi.mocked(invoke).mockResolvedValue(status({ binding: { ...status().binding!, keep: true } }));
  render(<RecorderStrip />);
  expect(screen.getByRole('alert')).toHaveTextContent('A chamada no Microsoft Teams terminou');
  expect(screen.getByText(/parando sozinho em 0:1[89]/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Parar agora' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Continuar gravando' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('auto_record_keep'));
  expect(await screen.findByText('Gravando 10:00')).toBeVisible();
});

it('leaves the ended prompt to the backend countdown only when auto-stop owns the call', () => {
  const detection = { enabled: true, supported: true, unavailable: false, calls: [call] };
  useAutoRecord.setState({ status: status(), stopAt: null });
  acceptDetectionStatus(detection, true);
  acceptDetectionStatus({ ...detection, calls: [] }, true);
  expect(useMeetingDetection.getState().callEndedPrompt).toBeNull();
  // Auto-stop off: the usual ended prompt asks the user.
  useAutoRecord.setState({
    status: status({ settings: { ...settings, stopWhenCallEnds: false } }),
  });
  useMeetingDetection.setState({ trackedCall: null, recordedCallKey: null });
  acceptDetectionStatus(detection, true);
  acceptDetectionStatus({ ...detection, calls: [] }, true);
  expect(useMeetingDetection.getState().callEndedPrompt).toEqual(call);
});

it('turning auto-record on also turns detection on, and detection off turns it off', async () => {
  useMeetingDetection.setState({ enabled: false });
  useAutoRecord.setState({ status: status({ settings: { ...settings, enabled: false } }) });
  vi.mocked(invoke).mockImplementation(async (_cmd, args) => ({
    ...status(),
    settings: (args as { settings: AutoRecordStatus['settings'] }).settings,
  }));
  render(<AutoRecordSettings />);
  expect(
    screen.getByText('Ligar a gravação automática também liga o aviso de chamadas.')
  ).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Gravar chamadas automaticamente' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('set_auto_record', {
      settings: { ...settings, enabled: true },
    })
  );
  expect(useMeetingDetection.getState().enabled).toBe(true);
  expect(
    await screen.findByRole('checkbox', { name: 'Parar quando a chamada terminar' })
  ).toBeChecked();
  const { setDetectionEnabled } = await import('../detection/meetingDetection');
  setDetectionEnabled(false);
  await waitFor(() =>
    expect(invoke).toHaveBeenLastCalledWith('set_auto_record', {
      settings: { ...settings, enabled: false },
    })
  );
});

it('device choices reach the backend so automatic captures use them', async () => {
  useAutoRecord.setState({ status: status() });
  vi.mocked(invoke).mockResolvedValue(status());
  chooseDevices({ mic: 'usb-headset' });
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('set_auto_record', {
      settings: { ...settings, micSource: 'usb-headset' },
    })
  );
});
