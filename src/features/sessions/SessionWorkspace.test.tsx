import { changeControl } from '../../test/changeControl';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Outlet, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { sessionCaptureCache } from './sessionCapture';
import { createAppRouter } from '../../router';
import { useAppStore } from '../../lib/store';
import { useSidebar } from '../../lib/sidebar';
import { sessionListCache, type Session } from './sessions';
vi.mock('../../routes/__root', () => ({ RootLayout: () => <Outlet /> }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
  convertFileSrc: (path: string) => path,
}));
vi.mock('../../components/AppShell/WindowChrome', () => ({
  WindowChromeProvider: ({ children }: { children: React.ReactNode }) => children,
  WindowChrome: ({ children }: { children: React.ReactNode }) => children,
  WindowDragRegion: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../components/AppShell/WindowFrame', () => ({
  WindowFrame: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../../components/AppShell/RecordingStatus', () => ({ RecordingStatus: () => null }));
vi.mock('../board/ActivityBoard', () => ({
  ActivityBoard: () => <div>Existing activity map</div>,
}));
vi.mock('../notes/NoteEditor', () => ({
  NoteEditor: ({ content }: { content: { markdown: string } }) => (
    <div role="textbox" aria-label="Existing editor">
      {content.markdown}
    </div>
  ),
  NoteLoadingSkeleton: () => <p>Loading editor</p>,
}));
vi.mock('../meetings/ProcessingPanel', () => ({
  ProcessingPanel: ({
    meetingId,
    view,
    onTranscript,
  }: {
    meetingId: string;
    view?: string;
    onTranscript?: () => void;
  }) =>
    view === 'people' ? (
      <button onClick={onTranscript}>Open Transcript</button>
    ) : (
      <p>Existing pipeline {meetingId}</p>
    ),
}));
const base: Session = {
  id: 's1',
  title: 'Design review',
  starts_at: null,
  ends_at: null,
  status: 'planned',
  origin: 'manual',
  meeting_id: null,
  personal_note: null,
  created_at: '2026-10-24T12:00:00Z',
  note_error: null,
  recording: null,
};
let rows: Session[];
let noteFailure = false;
let failDetail = false;
let activeMeeting: string | null = null;
const captureStatus = () => ({
  active: activeMeeting
    ? {
        meetingId: activeMeeting,
        paused: false,
        elapsedMs: 0,
        mic: { peak: 0, lastBlockMs: null, error: null },
        output: { peak: 0, lastBlockMs: null, error: null },
      }
    : null,
  error: null,
});
beforeEach(async () => {
  sessionCaptureCache.setState({ bySession: new Map() });
  await i18n.changeLanguage('en');
  useSidebar.getState().setOpen(true);
  useAppStore.setState({ notes: [] });
  sessionListCache.setState({ data: undefined, isError: false, updatedAt: 0 });
  rows = [{ ...base }];
  noteFailure = false;
  failDetail = false;
  activeMeeting = null;
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const a = args as Record<string, unknown>;
    if (command === 'library_sessions') return rows;
    if (command === 'library_session') {
      if (failDetail) throw new Error('detail temporarily unavailable');
      return rows.find((s) => s.id === a.sessionId);
    }
    if (command === 'library_create_session') {
      const s = { ...base, ...(a.input as object), id: 's2' };
      rows = [...rows, s];
      return s;
    }
    if (command === 'library_update_session') {
      rows = rows.map((s) => (s.id === a.sessionId ? { ...s, ...(a.input as object) } : s));
      return rows[0];
    }
    if (command === 'library_ensure_personal_note') {
      if (noteFailure) throw 'session_note_conflict';
      return {
        ...rows.find((s) => s.id === a.sessionId),
        personal_note: { id: 'n1', relative_path: 'notes/session-n1.md' },
      };
    }
    if (command === 'get_note')
      return {
        note: { id: 'n1', title: 'Private notes', tags: [] },
        markdown: 'User-authored content',
      };
    if (command === 'library_status') return captureStatus();
    if (command === 'library_stop') {
      activeMeeting = null;
      return captureStatus();
    }
    if (command === 'library_sources')
      return [
        { name: 'mic', description: 'Microphone', monitor: false },
        { name: 'monitor', description: 'Output', monitor: true },
      ];
    if (command === 'library_start_session') {
      rows = rows.map((s) =>
        s.id === a.sessionId
          ? {
              ...s,
              meeting_id: 'm1',
              recording: {
                id: 'm1',
                title: 'Independent recording title',
                captureState: 'recording',
                createdAt: base.created_at,
              },
            }
          : s
      );
      activeMeeting = 'm1';
      return captureStatus();
    }
    if (command === 'library_detail')
      return {
        meeting: { id: 'm1', title: 'Independent recording title', captureState: 'finished' },
        manifest: null,
        audio: null,
        inference: 'unavailable',
      };
    throw new Error(`Unexpected command ${command}`);
  });
});
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});
function setup(path = '/sessions/s1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(client);
  if (path !== '/') router.history.push(path);
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}
it('starts on map, lists real sessions, creates a no-audio session and keeps module buttons absent', async () => {
  const router = setup('/');
  expect(await screen.findByText('Existing activity map')).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: /Design review/ })).toBeInTheDocument();
  for (const name of ['Home', 'Library', 'Agenda', 'Notes'])
    expect(screen.queryByRole('link', { name })).toBeNull();
  expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'New meeting' }));
  changeControl(screen.getByRole('textbox', { name: 'Session title' }), {
    target: { value: 'No audio planning' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create session' }));
  expect(await screen.findByRole('heading', { name: 'No audio planning' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/sessions/s2');
  expect(await screen.findByRole('textbox', { name: 'Existing editor' })).toHaveTextContent(
    'User-authored content'
  );
  expect(invoke).toHaveBeenCalledWith('library_ensure_personal_note', { sessionId: 's2' });
  for (const command of [
    'create_note',
    'library_start',
    'library_start_session',
    'library_process',
    'library_import_audio',
  ])
    expect(invoke).not.toHaveBeenCalledWith(command, expect.anything());
});
it('uses roving keyboard tabs with honest transcript/summary and keeps no-audio notes recoverable', async () => {
  setup();
  await screen.findByRole('textbox', { name: 'Existing editor' });
  const notes = screen.getByRole('tab', { name: 'My notes' });
  notes.focus();
  fireEvent.keyDown(notes, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveFocus();
  expect(screen.getByRole('tabpanel')).toHaveTextContent('No transcript yet.');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Transcript' }), { key: 'End' });
  expect(screen.getByRole('tab', { name: 'Speakers' })).toHaveFocus();
  expect(screen.getByRole('tabpanel')).toHaveTextContent('No recording yet.');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Speakers' }), { key: 'ArrowLeft' });
  expect(screen.getByRole('tab', { name: 'Summary' })).toHaveFocus();
  expect(screen.getByRole('tabpanel')).toHaveTextContent('No summary generated.');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Summary' }), { key: 'Home' });
  expect(await screen.findByRole('textbox', { name: 'Existing editor' })).toHaveTextContent(
    'User-authored content'
  );
  expect(invoke).not.toHaveBeenCalledWith('library_process', expect.anything());
});
it('retries backend note conflict without creating a standalone clone', async () => {
  noteFailure = true;
  setup();
  expect(await screen.findByRole('alert')).toHaveTextContent('Personal notes need recovery');
  noteFailure = false;
  failDetail = false;
  activeMeeting = null;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('textbox', { name: 'Existing editor' })).toBeInTheDocument();
  expect(invoke).not.toHaveBeenCalledWith('create_note', expect.anything());
});
it('maps transcript to original recording ID while session title remains independent', async () => {
  rows[0] = {
    ...base,
    meeting_id: 'm1',
    recording: {
      id: 'm1',
      title: 'Independent recording title',
      captureState: 'finished',
      createdAt: base.created_at,
    },
  };
  setup();
  expect(await screen.findByRole('heading', { name: 'Design review' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Transcript' }));
  expect(await screen.findByText('Existing pipeline m1')).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Independent recording title' })).toBeNull();
  expect(invoke).toHaveBeenCalledWith('library_detail', { meetingId: 'm1' });
});
it('starts manual-session capture only after controls, sources and explicit start', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Design review' });
  expect(invoke).not.toHaveBeenCalledWith('library_sources');
  fireEvent.click(screen.getByRole('button', { name: 'Recording controls' }));
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Microphone' }), { key: 'ArrowDown' });
  await screen.findByRole('option', { name: /Microphone/ });
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  const selects = [
    screen.getByRole('combobox', { name: 'Microphone' }),
    screen.getByRole('combobox', { name: 'Output monitor' }),
  ];
  changeControl(selects[0], { target: { value: 'mic' } });
  changeControl(selects[1], { target: { value: 'monitor' } });
  const start = screen.getByRole('button', { name: /Start recording/ });
  fireEvent.click(start);
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('library_start_session', {
      sessionId: 's1',
      micSource: 'mic',
      outputSource: 'monitor',
    })
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].meeting_id).toBe('m1');
});
it('localizes session tabs and empty summary in Portuguese', async () => {
  await i18n.changeLanguage('pt-BR');
  setup();
  await screen.findByRole('tab', { name: 'Minhas notas' });
  fireEvent.click(screen.getByRole('tab', { name: 'Resumo' }));
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Nenhum resumo gerado.');
  fireEvent.click(screen.getByRole('tab', { name: 'Quem falou' }));
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Ainda não há gravação.');
});

it('retains the current session and owned stop controls when detail refresh fails after capture starts', async () => {
  setup();
  await screen.findByRole('textbox', { name: 'Existing editor' });
  failDetail = true;
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, args) =>
    command === 'library_detail' ? new Promise(() => {}) : original(command, args)
  );
  fireEvent.click(screen.getByRole('button', { name: 'Recording controls' }));
  fireEvent.keyDown(screen.getAllByRole('combobox')[0], { key: 'ArrowDown' });
  await screen.findByRole('option', { name: /Microphone/ });
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  const sources = [
    screen.getByRole('combobox', { name: 'Microphone' }),
    screen.getByRole('combobox', { name: 'Output monitor' }),
  ];
  changeControl(sources[0], { target: { value: 'mic' } });
  changeControl(sources[1], { target: { value: 'monitor' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Sessions are unavailable');
  expect(screen.getByRole('heading', { name: 'Design review' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Stop and save' })).toBeEnabled();
  expect(screen.queryByText(/Another session is recording/)).toBeNull();
  expect(screen.queryByText(/This session has no audio/)).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Transcript' }));
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Recording acknowledged.');
  expect(screen.getByRole('tabpanel')).not.toHaveTextContent('Record audio explicitly or import');
  for (const tab of screen.getAllByRole('tab'))
    expect(document.getElementById(tab.getAttribute('aria-controls')!)).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Stop and save' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('library_stop'));
});

it('fetches again immediately when creation invalidates an in-flight sidebar list', async () => {
  let resolveOld!: (value: Session[]) => void;
  const original = vi.mocked(invoke).getMockImplementation()!;
  let calls = 0;
  vi.mocked(invoke).mockImplementation((command, args) => {
    if (command === 'library_sessions' && ++calls === 1)
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    return original(command, args);
  });
  setup('/');
  await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: 'New meeting' }));
  changeControl(screen.getByRole('textbox', { name: 'Session title' }), {
    target: { value: 'Created during list fetch' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create session' }));
  await screen.findByRole('heading', { name: 'Created during list fetch' });
  await act(async () => resolveOld([{ ...base }]));
  // Default find timeout is 1s, below the 3s polling interval.
  expect(
    await screen.findByRole('button', { name: /Created during list fetch/ })
  ).toBeInTheDocument();
  expect(calls).toBe(2);
  expect(sessionListCache.getState().data?.map((s) => s.id)).toContain('s2');
});

it('wraps all four tabs and keeps every controlled panel present', async () => {
  setup();
  await screen.findByRole('textbox', { name: 'Existing editor' });
  const notes = screen.getByRole('tab', { name: 'My notes' });
  fireEvent.keyDown(notes, { key: 'ArrowLeft' });
  const people = screen.getByRole('tab', { name: 'Speakers' });
  expect(people).toHaveFocus();
  expect(people).toHaveAttribute('aria-selected', 'true');
  expect(notes).toHaveAttribute('tabindex', '-1');
  for (const tab of screen.getAllByRole('tab'))
    expect(document.getElementById(tab.getAttribute('aria-controls')!)).not.toBeNull();
  fireEvent.keyDown(people, { key: 'ArrowRight' });
  expect(notes).toHaveFocus();
});

it('opens the dedicated voices panel for the recording and returns focus to Transcript', async () => {
  rows[0] = {
    ...base,
    meeting_id: 'm1',
    recording: {
      id: 'm1',
      title: 'Recording',
      captureState: 'finished',
      createdAt: base.created_at,
    },
  };
  setup();
  await screen.findByRole('heading', { name: 'Design review' });
  fireEvent.click(screen.getByRole('tab', { name: 'Speakers' }));
  const open = await screen.findByRole('button', { name: 'Open Transcript' });
  expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'session-panel-people');
  for (const tab of screen.getAllByRole('tab'))
    expect(document.getElementById(tab.getAttribute('aria-controls')!)).not.toBeNull();
  fireEvent.click(open);
  expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveFocus();
  expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'session-panel-transcript');
  expect(await screen.findByText('Existing pipeline m1')).toBeVisible();
});

it('opens the global voice registry from the sidebar without opening a meeting', async () => {
  const previous = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, args) => {
    if (command === 'library_voice_profiles_page')
      return Promise.resolve({
        profileGeneration: 1,
        profiles: [{ personId: 'ana', name: 'Ana' }],
        nextCursor: null,
        scannedRows: 1,
      });
    return previous(command, args);
  });
  const router = setup('/');
  const link = await screen.findByRole('link', { name: 'People & voices' });
  fireEvent.click(link);
  expect(await screen.findByRole('heading', { name: 'People & voices', level: 1 })).toBeVisible();
  expect(await screen.findByText('Ana · ana')).toBeVisible();
  expect(router.state.location.pathname).toBe('/people');
  expect(link).toHaveAttribute('aria-current', 'page');
  expect(invoke).not.toHaveBeenCalledWith('library_session', expect.anything());
});
