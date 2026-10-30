import { changeControl } from '../../test/changeControl';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { sessionCaptureCache } from './sessionCapture';
import { SessionRecording } from './SessionRecording';
import type { Session } from './sessions';
import type { CaptureStatus } from '../meetings/library';
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
  convertFileSrc: (p: string) => p,
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../meetings/ProcessingPanel', () => ({
  ProcessingPanel: () => <p>Existing transcript pipeline</p>,
}));
const session = {
  id: 'one',
  title: 'Manual session',
  meeting_id: null,
  recording: null,
} as Session;
let active: CaptureStatus['active'];
beforeEach(async () => {
  sessionCaptureCache.setState({ bySession: new Map() });
  await i18n.changeLanguage('en');
  active = null;
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'library_status') return { active, error: null };
    if (command === 'library_sources')
      return [
        { name: 'mic', description: 'Microphone', monitor: false },
        { name: 'monitor', description: 'Monitor', monitor: true },
      ];
    if (command === 'library_start_session') {
      active = {
        meetingId: 'new-meeting',
        paused: false,
        elapsedMs: 0,
        mic: { peak: 0, lastBlockMs: null, error: null },
        output: { peak: 0, lastBlockMs: null, error: null },
      };
      return { active, error: null };
    }
    if (command === 'library_stop') {
      active = null;
      return { active: null, error: null };
    }
    if (command === 'library_detail')
      return {
        meeting: { id: 'old', captureState: 'finished' },
        manifest: null,
        audio: {
          mic: `http://127.0.0.1:34567/audio/${'ab'.repeat(32)}.wav`,
          output: `http://127.0.0.1:34567/audio/${'cd'.repeat(32)}.wav`,
        },
        inference: 'unavailable',
      };
    throw new Error(`Unexpected ${command}`);
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function start() {
  fireEvent.click(screen.getByRole('button', { name: 'Recording controls' }));
  fireEvent.keyDown(screen.getAllByRole('combobox')[0], { key: 'ArrowDown' });
  await screen.findByRole('option', { name: /Microphone/ });
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  const selects = screen.getAllByRole('combobox');
  changeControl(selects[0], { target: { value: 'mic' } });
  changeControl(selects[1], { target: { value: 'monitor' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop and save' })).toBeEnabled());
}
it('retains returned capture ownership and permits stop while the detail refresh is unresolved', async () => {
  let resolve!: () => void;
  const refresh = vi.fn(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  const view = render(<SessionRecording session={session} transcript={false} refresh={refresh} />);
  await start();
  expect(screen.queryByText(/Another session is recording/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
  expect(screen.queryByText(/This session has no audio/)).toBeNull();
  view.rerender(<SessionRecording session={session} transcript refresh={refresh} />);
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Recording acknowledged.');
  fireEvent.click(screen.getByRole('button', { name: 'Stop and save' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('library_stop'));
  expect(screen.queryByText(/Another session is recording/)).toBeNull();
  await act(async () => {
    resolve();
  });
  view.unmount();
});
it('keeps owned stop controls after a failed detail refresh and never assigns the returned ID to another session', async () => {
  const refresh = vi.fn().mockRejectedValue(new Error('refresh failed'));
  const view = render(<SessionRecording session={session} transcript={false} refresh={refresh} />);
  await start();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Recording is active in this session.'
  );
  expect(screen.getByRole('button', { name: 'Stop and save' })).toBeEnabled();
  expect(screen.queryByText(/Another session is recording/)).toBeNull();
  refresh.mockResolvedValueOnce(undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByRole('button', { name: 'Stop and save' })).toBeEnabled();
  view.rerender(
    <SessionRecording session={{ ...session, id: 'other' }} transcript={false} refresh={refresh} />
  );
  expect(screen.getByText(/Another session is recording/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Stop and save' })).toBeNull();
});
it('keeps players mounted but compact by default and expands playback explicitly without capture/source enumeration', async () => {
  const recorded = {
    ...session,
    meeting_id: 'old',
    recording: { id: 'old', title: 'Old recording', captureState: 'finished', createdAt: '' },
  } as Session;
  const view = render(<SessionRecording session={recorded} transcript={false} refresh={vi.fn()} />);
  const toggle = await screen.findByRole('button', { name: 'Playback' });
  const players = Array.from(view.container.querySelectorAll('audio'));
  expect(players).toHaveLength(2);
  expect(players[0]).not.toBeVisible();
  fireEvent.click(toggle);
  expect(screen.getByRole('button', { name: 'Listen to meeting' })).toBeVisible();
  expect(players[0]).not.toBeVisible();
  fireEvent.click(screen.getByText('Individual tracks'));
  expect(players[0]).toBeVisible();
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  view.rerender(<SessionRecording session={recorded} transcript refresh={vi.fn()} />);
  expect(view.container.querySelector('audio')).toBe(players[0]);
  expect(screen.getByText('Existing transcript pipeline')).toBeVisible();
  view.rerender(<SessionRecording session={recorded} transcript={false} refresh={vi.fn()} />);
  expect(view.container.querySelector('audio')).toBe(players[0]);
  expect(invoke).not.toHaveBeenCalledWith('library_sources');
  expect(invoke).not.toHaveBeenCalledWith('library_start_session', expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'Recording controls' }));
  expect(screen.getByText(/already has a recording/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start recording' })).toBeDisabled();
});

it('keeps live audio size and duration visible with recording controls collapsed', async () => {
  active = {
    meetingId: 'live-meeting',
    paused: true,
    elapsedMs: 180000,
    mic: { peak: 0, lastBlockMs: 0, error: null },
    output: { peak: 0, lastBlockMs: 0, error: null },
    storage: {
      directory: '/local/raw/live-meeting',
      totalBytes: 1048576,
      durationMs: 120000,
      files: [],
    },
  };
  render(
    <SessionRecording
      session={{ ...session, meeting_id: 'live-meeting' }}
      transcript={false}
      refresh={vi.fn()}
    />
  );
  expect(await screen.findByText('00:03:00')).toBeVisible();
  expect(screen.getByText('00:02:00')).toBeVisible();
  expect(screen.getByText('1 MiB')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Recording controls' })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  expect(invoke).not.toHaveBeenCalledWith('library_sources');
  expect(screen.getByRole('button', { name: 'Resume' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Stop and save' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Recording controls' }));
  expect(screen.getAllByRole('button', { name: 'Stop and save' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Recording controls' }));
  fireEvent.click(screen.getByRole('button', { name: 'Stop and save' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('library_stop'));
});

it('clears a transient status failure on the next successful poll', async () => {
  vi.useFakeTimers();
  const original = vi.mocked(invoke).getMockImplementation()!;
  let fail = true;
  vi.mocked(invoke).mockImplementation((command, args) => {
    if (command === 'library_status' && fail)
      return Promise.reject(new Error('temporary status failure'));
    return original(command, args);
  });
  await act(async () => {
    render(<SessionRecording session={session} transcript={false} refresh={vi.fn()} />);
  });
  expect(screen.getByRole('alert')).toBeInTheDocument();
  fail = false;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.queryByRole('alert')).toBeNull();
});
it('does not clear a device failure on a successful status poll, then clears it after source retry', async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  let failSources = true;
  vi.mocked(invoke).mockImplementation((command, args) => {
    if (command === 'library_sources' && failSources)
      return Promise.reject(new Error('source failure'));
    return original(command, args);
  });
  render(<SessionRecording session={session} transcript={false} refresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Recording controls' }));
  await screen.findByRole('alert');
  // Retry triggers an immediate successful status poll while sources still fail.
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() =>
    expect(
      vi.mocked(invoke).mock.calls.filter(([c]) => c === 'library_status').length
    ).toBeGreaterThan(1)
  );
  expect(screen.getByRole('alert')).toBeInTheDocument();
  failSources = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  fireEvent.keyDown(screen.getAllByRole('combobox')[0], { key: 'ArrowDown' });
  await screen.findByRole('option', { name: /Microphone/ });
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});
it('keeps failed capture actions visible until an explicit successful action, without automatically retrying capture', async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  let failStart = true;
  vi.mocked(invoke).mockImplementation((command, args) => {
    if (command === 'library_start_session' && failStart)
      return Promise.reject(new Error('capture failure'));
    return original(command, args);
  });
  render(
    <SessionRecording
      session={session}
      transcript={false}
      refresh={vi.fn().mockResolvedValue(undefined)}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Recording controls' }));
  fireEvent.keyDown(screen.getAllByRole('combobox')[0], { key: 'ArrowDown' });
  await screen.findByRole('option', { name: /Microphone/ });
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  const selects = screen.getAllByRole('combobox');
  changeControl(selects[0], { target: { value: 'mic' } });
  changeControl(selects[1], { target: { value: 'monitor' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() =>
    expect(
      vi.mocked(invoke).mock.calls.filter(([c]) => c === 'library_status').length
    ).toBeGreaterThan(1)
  );
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === 'library_start_session')).toHaveLength(
    1
  );
  failStart = false;
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop and save' })).toBeEnabled());
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each(['en', 'pt-BR'])(
  'keeps owned active failure/help in this workspace (%s)',
  async (language) => {
    await i18n.changeLanguage(language);
    active = {
      meetingId: 'owned',
      paused: false,
      elapsedMs: 0,
      mic: { peak: 0, lastBlockMs: null, error: null },
      output: { peak: 0, lastBlockMs: null, error: null },
    };
    const original = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((command, args) =>
      command === 'library_detail'
        ? Promise.reject(new Error('details unavailable'))
        : original(command, args)
    );
    render(
      <SessionRecording
        session={{ ...session, meeting_id: 'owned' }}
        transcript
        refresh={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('session.activeAudioFailed'))
    );
    fireEvent.click(screen.getByRole('button', { name: i18n.t('session.capture') }));
    expect(screen.getByText(i18n.t('session.ownedCaptureHelp'))).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveTextContent(i18n.t('session.transcriptPending'));
    expect(screen.queryByRole('link', { name: i18n.t('session.captureUtility') })).toBeNull();
    expect(screen.queryByText(i18n.t('session.audioFailed'))).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith('library_start_session', expect.anything());
  }
);

it('does not enable another start when pre-capture new metadata arrives after acknowledged capture has stopped', async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const view = render(<SessionRecording session={session} transcript={false} refresh={refresh} />);
  await start();
  fireEvent.click(screen.getByRole('button', { name: 'Stop and save' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('library_stop'));
  view.rerender(
    <SessionRecording
      session={{
        ...session,
        meeting_id: 'new-meeting',
        recording: {
          id: 'new-meeting',
          title: 'Manual session',
          captureState: 'new',
          createdAt: '',
        },
      }}
      transcript={false}
      refresh={refresh}
    />
  );
  expect(screen.getByRole('button', { name: 'Start recording' })).toBeDisabled();
  expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === 'library_start_session')).toHaveLength(
    1
  );
});

it('links to capture and import with a button-styled link instead of underlined text', async () => {
  render(<SessionRecording session={session} transcript={false} refresh={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('session.capture') }));
  const library = await screen.findByRole('link', { name: i18n.t('session.captureUtility') });
  expect(library).toHaveAttribute('href', '/meetings');
  expect(library).toHaveClass('cx-btn');
  expect(library).toHaveAttribute('data-variant', 'secondary');
  expect(screen.getByRole('button', { name: i18n.t('session.capture') })).toHaveAttribute(
    'data-variant',
    'ghost'
  );
});
