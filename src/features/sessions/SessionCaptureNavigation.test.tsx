import { changeControl } from '../../test/changeControl';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Outlet, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { createAppRouter } from '../../router';
import { useSidebar } from '../../lib/sidebar';
import { sessionListCache, type Session } from './sessions';
import type { CaptureStatus } from '../meetings/library';
vi.mock('../../routes/__root', () => ({ RootLayout: () => <Outlet /> }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
  convertFileSrc: (p: string) => p,
}));
vi.mock('../../components/AppShell/WindowChrome', () => ({
  WindowChromeProvider: ({ children }: { children: React.ReactNode }) => children,
  WindowChrome: ({ children }: { children: React.ReactNode }) => children,
  WindowDragRegion: () => null,
}));
vi.mock('../../components/AppShell/WindowFrame', () => ({
  WindowFrame: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../../components/AppShell/RecordingStatus', () => ({ RecordingStatus: () => null }));
vi.mock('../board/ActivityBoard', () => ({ ActivityBoard: () => <p>Activity map</p> }));
vi.mock('../notes/NoteEditor', () => ({
  NoteEditor: () => <p>Personal notes</p>,
  NoteLoadingSkeleton: () => null,
}));
vi.mock('../meetings/ProcessingPanel', () => ({ ProcessingPanel: () => <p>Existing pipeline</p> }));
let testId = 0;
let rows: Session[];
let active: CaptureStatus['active'];
let metadata: 'stale' | 'failed';
let rejectStart: boolean;
let resolveStale: ((value: Session) => void) | null;
let deferMetadata: boolean;
const meter = { peak: 0, lastBlockMs: null, error: null };
const currentStatus = () => ({ active, error: null });
beforeEach(async () => {
  await i18n.changeLanguage('en');
  useSidebar.getState().setOpen(true);
  sessionListCache.setState({ data: undefined, isError: false, updatedAt: 0 });
  testId++;
  rows = ['one', 'two'].map((id) => ({
    id: `${id}-${testId}`,
    title: `Session ${id}`,
    starts_at: null,
    ends_at: null,
    status: 'planned',
    origin: 'manual',
    meeting_id: null,
    personal_note: null,
    created_at: '2026-10-24T12:00:00Z',
    note_error: null,
    recording: null,
  }));
  active = null;
  metadata = 'stale';
  rejectStart = false;
  resolveStale = null;
  deferMetadata = false;
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const a = args as Record<string, string>;
    if (command === 'library_sessions') return rows;
    if (command === 'library_session') {
      if (deferMetadata)
        return new Promise<Session>((r) => {
          resolveStale = r;
        });
      if (metadata === 'failed') throw new Error('persistent session metadata failure');
      return rows.find((s) => s.id === a.sessionId);
    }
    if (command === 'library_ensure_personal_note')
      return { personal_note: { id: `note-${a.sessionId}` } };
    if (command === 'get_note')
      return { note: { id: a.id, title: 'Personal', tags: [] }, markdown: 'Private body' };
    if (command === 'library_status') return currentStatus();
    if (command === 'library_sources')
      return [
        { name: 'mic', description: 'Microphone', monitor: false },
        { name: 'monitor', description: 'Output', monitor: true },
      ];
    if (command === 'library_start_session') {
      if (rejectStart) throw new Error('start rejected');
      active = {
        meetingId: `meeting-${a.sessionId}`,
        paused: false,
        elapsedMs: 0,
        mic: meter,
        output: meter,
      };
      return currentStatus();
    }
    if (command === 'library_stop') {
      active = null;
      return currentStatus();
    }
    if (command === 'library_detail') throw new Error('recording details temporarily unavailable');
    throw new Error(`Unexpected command ${command}`);
  });
});
afterEach(cleanup);
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(client);
  router.history.push(`/sessions/${rows[0].id}`);
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return { router, client };
}
async function controls() {
  fireEvent.click(screen.getByRole('button', { name: 'Recording controls' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('library_sources'));
}
async function start() {
  await controls();
  fireEvent.keyDown(screen.getAllByRole('combobox')[0], { key: 'ArrowDown' });
  await screen.findByRole('option', { name: /Microphone/ });
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  const selects = [
    screen.getByRole('combobox', { name: 'Microphone' }),
    screen.getByRole('combobox', { name: 'Output monitor' }),
  ];
  changeControl(selects[0], { target: { value: 'mic' } });
  changeControl(selects[1], { target: { value: 'monitor' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
}
async function returnViaMap(router: ReturnType<typeof createAppRouter>) {
  await act(async () => {
    await router.navigate({ to: '/' });
  });
  await screen.findByText('Activity map');
  fireEvent.click(screen.getByRole('button', { name: /Session one/ }));
  await screen.findByRole('heading', { name: 'Session one' });
  await controls();
}
it('retains acknowledged ownership after map/remount with persistent metadata failure, then stop/revisit without duplicate start', async () => {
  const { router } = mount();
  await screen.findByRole('heading', { name: 'Session one' });
  metadata = 'failed';
  await start();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop and save' })).toBeEnabled());
  await returnViaMap(router);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop and save' })).toBeEnabled());
  expect(screen.queryByText(/Another session is recording/)).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Transcript' }));
  expect(screen.getByRole('tabpanel')).not.toHaveTextContent('No transcript yet.');
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Recording acknowledged.');
  expect(
    within(screen.getByRole('region', { name: 'Session audio' })).queryByText(/capture utility/i)
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Stop and save' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('library_stop'));
  await returnViaMap(router);
  expect(screen.getByRole('button', { name: 'Start recording' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Stop and save' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Transcript' }));
  expect(screen.getByRole('tabpanel')).not.toHaveTextContent('No transcript yet.');
  expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === 'library_start_session')).toHaveLength(
    1
  );
  expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === 'library_stop')).toHaveLength(1);
});
it('retains acknowledgement through late null metadata and isolates another session', async () => {
  const { router, client } = mount();
  await screen.findByRole('heading', { name: 'Session one' });
  deferMetadata = true;
  const refetch = client.refetchQueries({ queryKey: ['session', rows[0].id] });
  await waitFor(() => expect(resolveStale).toBeTypeOf('function'));
  await start();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop and save' })).toBeEnabled());
  deferMetadata = false;
  await act(async () => {
    resolveStale!(rows[0]);
    await refetch;
  });
  expect(client.getQueryData<Session>(['session', rows[0].id])?.meeting_id).toBeNull();
  await returnViaMap(router);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop and save' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /Session two/ }));
  await screen.findByRole('heading', { name: 'Session two' });
  await controls();
  expect(await screen.findByText(/Another session is recording/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Stop and save' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Transcript' }));
  expect(screen.getByRole('tabpanel')).toHaveTextContent('No transcript yet.');
  expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === 'library_start_session')).toHaveLength(
    1
  );
});
it('does not infer ownership from status after a rejected explicit start', async () => {
  const { router } = mount();
  await screen.findByRole('heading', { name: 'Session one' });
  rejectStart = true;
  await start();
  await screen.findByRole('alert');
  active = {
    meetingId: `meeting-${rows[0].id}`,
    paused: false,
    elapsedMs: 0,
    mic: meter,
    output: meter,
  };
  await returnViaMap(router);
  expect(await screen.findByText(/Another session is recording/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Stop and save' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Transcript' }));
  expect(screen.getByRole('tabpanel')).toHaveTextContent('No transcript yet.');
  expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === 'library_start_session')).toHaveLength(
    1
  );
});
