import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { Shell } from '../../components/Shell/Shell';
import { initialCaptureState, useCaptureStore } from '../capture/captureStore';
import { useMeetingDetection } from '../detection/meetingDetection';
import { GeneralSection } from './GeneralSection';
import { RecordingSection } from './RecordingSection';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
  convertFileSrc: (path: string) => path,
}));
// The real Shell applies `data-ambient`; its strip, rail and window chrome are not under test.
vi.mock('../../components/Shell/NavRail', () => ({ NavRail: () => null }));
vi.mock('../capture/RecorderStrip', () => ({ RecorderStrip: () => null }));
vi.mock('../../components/AppShell/WindowChrome', () => ({
  WindowChromeProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../../components/AppShell/WindowFrame', () => ({
  WindowFrame: ({ children }: { children: React.ReactNode }) => children,
}));

const sources = [
  { name: 'mic-usb', description: 'Headset USB', monitor: false, is_default: true },
  { name: 'mic-laptop', description: 'Microfone interno', monitor: false },
  { name: 'out.monitor', description: 'Alto-falantes', monitor: true, is_default: true },
  { name: 'hdmi.monitor', description: 'HDMI', monitor: true },
];
const tr = (key: string) => i18n.t(key);
const CAPTURE_COMMANDS = [
  'library_start',
  'library_start_session',
  'library_pause',
  'library_stop',
];

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
  localStorage.clear();
  delete document.documentElement.dataset.ambient;
  useCaptureStore.setState({ ...initialCaptureState });
  useMeetingDetection.setState({ enabled: true, status: null, failed: false });
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === 'library_sources') return sources;
    throw new Error(`unexpected ${command}`);
  });
});
afterEach(cleanup);

it('ambient toggle persists the preference and switches data-ambient on the document', async () => {
  const user = userEvent.setup();
  render(
    <Shell>
      <GeneralSection />
    </Shell>
  );
  const toggle = screen.getByRole('checkbox', { name: tr('people.settings.ambient.title') });
  expect(toggle).toBeChecked();
  expect(toggle).toHaveAccessibleDescription(tr('people.settings.ambient.hint'));
  await user.click(toggle);
  expect(toggle).not.toBeChecked();
  expect(localStorage.getItem('coxinha:ambient-gradient')).toBe('off');
  expect(document.documentElement.dataset.ambient).toBe('off');
  await user.click(toggle);
  expect(localStorage.getItem('coxinha:ambient-gradient')).toBe('on');
  expect(document.documentElement.dataset.ambient).toBeUndefined();
});

it('theme is a labelled radio group whose thumb slides to the chosen option', async () => {
  const user = userEvent.setup();
  render(<GeneralSection />);
  const group = screen.getByRole('radiogroup', { name: tr('people.settings.theme.title') });
  expect(screen.getByRole('radio', { name: 'Automático' })).toBeChecked();
  expect(group.style.getPropertyValue('--index')).toBe('0');
  await user.click(screen.getByRole('radio', { name: 'Escuro' }));
  expect(localStorage.getItem('coxinha.themePref')).toBe('dark');
  expect(group.style.getPropertyValue('--index')).toBe('2');
});

it('loads devices once, writes choices through chooseDevices and never starts capture', async () => {
  const user = userEvent.setup();
  render(<RecordingSection />);
  const mic = await screen.findByRole('combobox', { name: tr('people.settings.mic.title') });
  await waitFor(() => expect(mic).toHaveTextContent('Headset USB (padrão do sistema)'));
  expect(invoke).toHaveBeenCalledWith('library_sources');
  const output = screen.getByRole('combobox', { name: tr('people.settings.output.title') });
  expect(output).toHaveTextContent('Alto-falantes (padrão do sistema)');

  await user.click(mic);
  // Microphones only: monitors never appear as a voice source.
  expect(screen.queryByRole('option', { name: 'HDMI' })).toBeNull();
  await user.click(await screen.findByRole('option', { name: 'Microfone interno' }));
  await waitFor(() => expect(useCaptureStore.getState().mic).toBe('mic-laptop'));
  expect(localStorage.getItem('coxinha:capture-mic')).toBe('mic-laptop');

  await user.click(output);
  await user.click(await screen.findByRole('option', { name: 'HDMI' }));
  await waitFor(() => expect(useCaptureStore.getState().output).toBe('hdmi.monitor'));
  expect(localStorage.getItem('coxinha:capture-output')).toBe('hdmi.monitor');

  const commands = vi.mocked(invoke).mock.calls.map(([command]) => command);
  expect(commands.filter((c) => CAPTURE_COMMANDS.includes(c))).toEqual([]);
  expect(useCaptureStore.getState().status).toBeNull();
});

it('shows a retry when devices cannot be listed, and notes that a live capture keeps its devices', async () => {
  const user = userEvent.setup();
  vi.mocked(invoke).mockRejectedValueOnce(new Error('pactl missing'));
  render(<RecordingSection />);
  const retry = await screen.findByRole('button', { name: tr('people.settings.devices.retry') });
  expect(screen.getByText(tr('people.settings.devices.error'))).toBeVisible();
  await user.click(retry);
  await waitFor(() =>
    expect(
      screen.getByRole('combobox', { name: tr('people.settings.mic.title') })
    ).toHaveTextContent('Headset USB')
  );
  act(() =>
    useCaptureStore.setState({
      status: {
        active: {
          meetingId: 'm1',
          paused: false,
          elapsedMs: 1,
          mic: { peak: 0, lastBlockMs: null, error: null },
          output: { peak: 0, lastBlockMs: null, error: null },
        },
        error: null,
      },
    })
  );
  expect(screen.getByText(tr('people.settings.devices.liveNote'))).toBeVisible();
});

it('call detection is a switch row in Gravação that persists the preference', async () => {
  const user = userEvent.setup();
  render(<RecordingSection />);
  const detection = screen.getByRole('checkbox', { name: tr('people.settings.detection.title') });
  expect(detection).toBeChecked();
  await user.click(detection);
  expect(localStorage.getItem('coxinha:meeting-detection')).toBe('false');
  expect(useMeetingDetection.getState().enabled).toBe(false);
});
