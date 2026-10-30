import { changeControl } from '../../test/changeControl';
import { open } from '@tauri-apps/plugin-dialog';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../lib/i18n';
import { LibraryView } from './LibraryView';
import { library, meterDiagnostic, validSources } from './library';
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('./library', async (original) => {
  const actual = await original<typeof import('./library')>();
  return {
    ...actual,
    library: {
      importAudio: vi.fn(),
      available: vi.fn(),
      list: vi.fn(),
      sources: vi.fn(),
      status: vi.fn(),
      start: vi.fn(),
      pause: vi.fn(),
      stop: vi.fn(),
      detail: vi.fn(),
      recover: vi.fn(),
      processing: vi.fn(),
      audioUrl: (path: string) => `asset:${path}`,
    },
  };
});
const mic = { name: 'mic', description: 'Desk mic', monitor: false };
const output = { name: 'sink.monitor', description: 'Speakers', monitor: true };
const meter = { peak: 0.2, lastBlockMs: 0, error: null };
const active = { meetingId: 'm1', paused: false, elapsedMs: 1000, mic: meter, output: meter };
const meeting = {
  id: 'm1',
  title: 'Planning',
  createdAt: '2026-10-18T10:00:00Z',
  captureState: 'finished' as const,
};
const detail = {
  meeting,
  manifest: null,
  audio: { mic: '/mic.wav', output: '/output.wav' },
  inference: 'unavailable' as const,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(library.processing).mockResolvedValue({ jobs: [], report: null, people: [] });
  vi.mocked(library.available).mockReturnValue(true);
  vi.mocked(library.sources).mockResolvedValue([mic, output]);
  vi.mocked(library.list).mockResolvedValue([]);
  vi.mocked(library.status).mockResolvedValue({ active: null, error: null });
  vi.mocked(library.detail).mockResolvedValue(detail);
});
describe('meeting library', () => {
  it('imports a single WAV with native selection and shows only its track', async () => {
    vi.mocked(open).mockResolvedValue('/input.wav');
    vi.mocked(library.importAudio).mockResolvedValue({
      ...detail,
      audio: { imported: '/owned/imported.wav' },
    });
    render(<LibraryView />);
    changeControl(screen.getByLabelText('Meeting title'), { target: { value: 'Planning' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import local WAV' }));
    await waitFor(() => expect(library.importAudio).toHaveBeenCalledWith('Planning', '/input.wav'));
    expect(await screen.findByLabelText('Play Imported audio')).toHaveAttribute(
      'src',
      'asset:/owned/imported.wav'
    );
    expect(screen.queryByLabelText('Microphone playback')).not.toBeInTheDocument();
  });
  it('shows import failure and releases busy state', async () => {
    vi.mocked(open).mockResolvedValue('/invalid.wav');
    vi.mocked(library.importAudio).mockRejectedValue(new Error('Unsupported PCM WAV'));
    render(<LibraryView />);
    changeControl(screen.getByLabelText('Meeting title'), { target: { value: 'Planning' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import local WAV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unsupported PCM WAV');
    expect(screen.getByRole('button', { name: 'Import local WAV' })).toBeEnabled();
  });
  it('requires explicit valid sources and performs start, pause, resume and stop', async () => {
    let capture: Awaited<ReturnType<typeof library.status>> = { active: null, error: null };
    vi.mocked(library.status).mockImplementation(async () => capture);
    vi.mocked(library.start).mockImplementation(async () => {
      capture = { active, error: null };
      return capture;
    });
    vi.mocked(library.pause).mockImplementation(async (paused) => {
      capture = { active: { ...active, paused }, error: null };
      return capture;
    });
    vi.mocked(library.stop).mockImplementation(async () => {
      capture = { active: null, error: null };
      return capture;
    });
    vi.useFakeTimers();
    const view = render(<LibraryView />);
    try {
      await act(async () => {});
      fireEvent.keyDown(screen.getByRole('combobox', { name: 'Microphone' }), { key: 'ArrowDown' });
      expect(screen.getByRole('option', { name: 'Desk mic' })).toBeVisible();
      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
      const start = screen.getByRole('button', { name: 'Start recording' });
      expect(start).toBeDisabled();
      changeControl(screen.getByLabelText('Meeting title'), { target: { value: 'Planning' } });
      changeControl(screen.getByLabelText('Microphone'), { target: { value: 'mic' } });
      expect(start).toBeDisabled();
      changeControl(screen.getByLabelText('Output monitor'), {
        target: { value: 'sink.monitor' },
      });
      await act(async () => {
        fireEvent.click(start);
      });
      expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
      expect(library.start).toHaveBeenCalledWith('Planning', 'mic', 'sink.monitor');
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      });
      expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
      });
      expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
      // Reproduce a real status poll between resume and stop, without wall-clock sleeps.
      const statusCalls = vi.mocked(library.status).mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      expect(library.status).toHaveBeenCalledTimes(statusCalls + 1);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Stop and save' }));
      });
      expect(screen.getByRole('button', { name: 'Start recording' })).toBeEnabled();
      expect(library.stop).toHaveBeenCalledOnce();
      expect(vi.mocked(library.pause).mock.calls).toEqual([[true], [false]]);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });
  it('keeps failed commands visible and does not pretend capture succeeded', async () => {
    vi.mocked(library.status).mockResolvedValue({ active, error: null });
    vi.mocked(library.pause).mockRejectedValue('Device disconnected');
    render(<LibraryView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Device disconnected');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
  });
  it('loads durable recordings after remount and uses separate verified playback paths', async () => {
    vi.mocked(library.list).mockResolvedValue([meeting]);
    const first = render(<LibraryView />);
    fireEvent.click(await screen.findByRole('button', { name: /Planning/ }));
    await waitFor(() =>
      expect(screen.getByLabelText('Microphone playback')).toHaveAttribute('src', 'asset:/mic.wav')
    );
    expect(screen.getByLabelText('Output monitor playback')).toHaveAttribute(
      'src',
      'asset:/output.wav'
    );
    first.unmount();
    render(<LibraryView />);
    expect(await screen.findByRole('button', { name: /Planning/ })).toBeVisible();
    expect(library.start).not.toHaveBeenCalled();
  });
  it('recovers an interrupted capture explicitly', async () => {
    vi.mocked(library.list).mockResolvedValue([{ ...meeting, captureState: 'interrupted' }]);
    vi.mocked(library.detail).mockResolvedValue({
      ...detail,
      meeting: { ...meeting, captureState: 'interrupted' },
      audio: null,
    });
    vi.mocked(library.recover).mockResolvedValue(detail);
    render(<LibraryView />);
    fireEvent.click(await screen.findByRole('button', { name: /Planning/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Recover interrupted capture' }));
    expect(await screen.findByRole('button', { name: 'Listen to meeting' })).toBeVisible();
    expect(screen.getByLabelText('Microphone playback')).not.toBeVisible();
    fireEvent.click(screen.getByText('Individual tracks'));
    expect(screen.getByLabelText('Microphone playback')).toBeVisible();
    expect(library.recover).toHaveBeenCalledWith('m1');
  });
  it('reports the desktop requirement and never calls IPC in browser preview', async () => {
    vi.mocked(library.available).mockReturnValue(false);
    render(<LibraryView />);
    expect(screen.getByRole('status')).toHaveTextContent('desktop runtime is required');
    await act(async () => {});
    expect(library.sources).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeDisabled();
  });
});
it('uses shared buttons: one primary capture action, secondary import, ghost refresh', async () => {
  render(<LibraryView />);
  await act(async () => {});
  expect(screen.getByRole('heading', { level: 1, name: 'Meeting library' })).toBeVisible();
  const start = screen.getByRole('button', { name: 'Start recording' });
  expect(start).toHaveClass('cx-btn');
  expect(start).toHaveAttribute('data-variant', 'primary');
  expect(screen.getByRole('button', { name: 'Import local WAV' })).toHaveAttribute(
    'data-variant',
    'secondary'
  );
  const refresh = screen.getByRole('button', { name: 'Refresh' });
  expect(refresh).toHaveAttribute('data-variant', 'ghost');
  expect(screen.getByLabelText('Meeting title')).toHaveClass('cx-input');
  expect(screen.getByRole('combobox', { name: 'Microphone' })).toHaveAttribute(
    'data-block',
    'true'
  );
});
it('rejects duplicate, missing and wrong-kind selections', () => {
  expect(validSources([mic, output], 'mic', 'sink.monitor')).toBe(true);
  for (const [a, b] of [
    ['mic', 'mic'],
    ['sink.monitor', 'mic'],
    ['missing', 'sink.monitor'],
  ])
    expect(validSources([mic, output], a, b)).toBe(false);
});
it('distinguishes source failures, stalls, waiting, silence and pause', () => {
  expect(meterDiagnostic({ ...meter, error: 'gone' }, false)).toBe('error');
  expect(meterDiagnostic(meter, true)).toBe('paused');
  expect(meterDiagnostic({ ...meter, lastBlockMs: null }, false)).toBe('waiting');
  expect(meterDiagnostic({ ...meter, lastBlockMs: 3000 }, false)).toBe('stalled');
  expect(meterDiagnostic({ ...meter, peak: 0 }, false)).toBe('silence');
});

it.each([false, true])('ignores an earlier poll after pause, then stop=%s', async (stop) => {
  vi.useFakeTimers();
  let resolvePoll!: (value: { active: typeof active; error: null }) => void;
  vi.mocked(library.status)
    .mockResolvedValueOnce({ active, error: null })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        })
    );
  vi.mocked(library.pause).mockResolvedValue({ active: { ...active, paused: true }, error: null });
  vi.mocked(library.stop).mockResolvedValue({ active: null, error: null });
  const view = render(<LibraryView />);
  try {
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    });
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
    if (stop)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Stop and save' }));
      });
    await act(async () => {
      resolvePoll({ active, error: null });
    });
    expect(screen.getByRole('button', { name: stop ? 'Start recording' : 'Resume' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

it('refreshes recordings and status even if enumerating sources fails', async () => {
  const view = render(<LibraryView />);
  fireEvent.keyDown(screen.getAllByRole('combobox')[0], { key: 'ArrowDown' });
  await screen.findByRole('option', { name: 'Desk mic' });
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  vi.mocked(library.sources).mockRejectedValue('Audio server unavailable');
  vi.mocked(library.list).mockResolvedValue([meeting]);
  vi.mocked(library.status).mockResolvedValue({ active, error: null });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByRole('button', { name: /Planning/ })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Audio server unavailable');
  view.unmount();
});
