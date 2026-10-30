import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Outlet, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { createAppRouter } from '../../router';
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
  WindowDragRegion: () => null,
}));
vi.mock('../../components/AppShell/WindowFrame', () => ({
  WindowFrame: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../../components/AppShell/RecordingStatus', () => ({ RecordingStatus: () => null }));
vi.mock('../board/ActivityBoard', () => ({ ActivityBoard: () => <p>Activity map</p> }));
vi.mock('../notes/NoteEditor', () => ({
  NoteEditor: ({ content }: { content: { markdown: string } }) => (
    <p data-testid="editor-content">{content.markdown}</p>
  ),
  NoteLoadingSkeleton: () => null,
}));
const rows = ['one', 'two'].map(
  (id) =>
    ({
      id,
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
    }) as Session
);
let resolveOld: (value: unknown) => void;
let slowOld = false;
beforeEach(async () => {
  await i18n.changeLanguage('en');
  useSidebar.getState().setOpen(true);
  sessionListCache.setState({ data: undefined, isError: false, updatedAt: 0 });
  slowOld = false;
  rows.forEach((s) => {
    s.starts_at = null;
  });
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const a = args as Record<string, string>;
    if (command === 'library_sessions') return rows;
    if (command === 'library_session') return rows.find((s) => s.id === a.sessionId);
    if (command === 'library_status') return { active: null, error: null };
    if (command === 'library_ensure_personal_note') {
      if (slowOld && a.sessionId === 'one')
        return new Promise((r) => {
          resolveOld = r;
        });
      return { personal_note: { id: `note-${a.sessionId}` } };
    }
    if (command === 'get_note')
      return { note: { id: a.id, title: 'Private note', tags: [] }, markdown: `Body ${a.id}` };
    throw new Error(`Unexpected ${command}`);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(client);
  router.history.push('/sessions/one');
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}
it('keeps the same sidebar button focused through keyboard session navigation without loading/refetch flash', async () => {
  const router = mount();
  const two = await screen.findByRole('button', { name: /Session two/ });
  const calls = vi.mocked(invoke).mock.calls.filter(([c]) => c === 'library_sessions').length;
  two.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(router.state.location.pathname).toBe('/sessions/two'));
  expect(await screen.findByTestId('editor-content')).toHaveTextContent('Body note-two');
  expect(screen.getByRole('button', { name: /Session two/ })).toBe(two);
  expect(two).toHaveFocus();
  expect(two).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByText('Loading sessions…')).toBeNull();
  expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === 'library_sessions')).toHaveLength(
    calls
  );
});
it('isolates a late previous-session note response while the shell and list stay stable', async () => {
  slowOld = true;
  const router = mount();
  await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
  fireEvent.click(await screen.findByRole('button', { name: /Session two/ }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/sessions/two'));
  expect(await screen.findByTestId('editor-content')).toHaveTextContent('Body note-two');
  await act(async () => {
    resolveOld({ personal_note: { id: 'note-one' } });
  });
  expect(screen.getByTestId('editor-content')).toHaveTextContent('Body note-two');
  expect(screen.getByRole('heading', { name: 'Session two' })).toBeInTheDocument();
});
it('serves cached rows synchronously after navigating away and back without another list request', async () => {
  const router = mount();
  await screen.findByRole('button', { name: /Session two/ });
  const calls = vi.mocked(invoke).mock.calls.filter(([c]) => c === 'library_sessions').length;
  await act(async () => {
    await router.navigate({ to: '/' });
  });
  expect(screen.getByRole('button', { name: /Session two/ })).toBeInTheDocument();
  expect(screen.queryByText('Loading sessions…')).toBeNull();
  await act(async () => {
    await router.navigate({ to: '/sessions/$sessionId', params: { sessionId: 'two' } });
  });
  expect(screen.queryByText('Loading sessions…')).toBeNull();
  expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === 'library_sessions')).toHaveLength(
    calls
  );
});

it('formats sidebar occurrence dates using the app locale', async () => {
  await i18n.changeLanguage('pt-BR');
  rows[1].starts_at = '2026-10-24T12:00:00Z';
  const format = vi.spyOn(Date.prototype, 'toLocaleTimeString');
  mount();
  await screen.findByRole('button', { name: /Session two/ });
  expect(format).toHaveBeenCalledWith('pt-BR', { hour: '2-digit', minute: '2-digit' });
});
