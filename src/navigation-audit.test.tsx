import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Outlet, RouterProvider } from '@tanstack/react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import './lib/i18n';
import { createAppRouter } from './router';
import { useAppStore } from './lib/store';
vi.mock('./routes/__root', () => ({ RootLayout: () => <Outlet /> }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock('./features/board/ActivityBoard', () => ({
  ActivityBoard: () => <div>Existing activity map</div>,
}));
vi.mock('./features/notes/NoteEditor', () => ({
  NoteEditor: () => <div>Working note editor</div>,
  NoteLoadingSkeleton: () => null,
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockReset();
  useAppStore.setState({ notes: [] });
});
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(client);
  router.history.push('/home');
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}
it('does not offer fixture notes from Meetings or Home on a fresh vault', async () => {
  const router = setup();
  await screen.findByRole('button', { name: 'Activity map' });
  expect(screen.queryByRole('link', { name: 'IT Weekly Status Meeting' })).not.toBeInTheDocument();
  await act(async () => {
    await router.navigate({ to: '/' });
  });
  await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  expect(screen.queryByText('Rename AI')).not.toBeInTheDocument();
  expect(screen.queryByText('Rita Menezes')).not.toBeInTheDocument();
  expect(invoke).not.toHaveBeenCalledWith('get_note', expect.anything());
});
it('keeps navigation available when a fixture or stale UUID cannot be opened through generated IPC bindings', async () => {
  const router = setup();
  await screen.findByRole('button', { name: 'Activity map' });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  const id = '00000000-0000-4000-8000-000000000001';
  for (const [noteId, error] of [
    [
      'it-weekly-status',
      'invalid args `id` for command `get_note`: invalid character: found `i` at 0',
    ],
    [id, `note ${id} not found`],
  ]) {
    vi.mocked(invoke).mockRejectedValueOnce(error);
    await act(async () => {
      await router.navigate({ to: '/notes/$noteId', params: { noteId } });
    });
    expect(invoke).toHaveBeenCalledWith('get_note', { id: noteId });
    expect(await screen.findByRole('heading', { name: 'Note unavailable' })).toBeInTheDocument();
    expect(screen.getByText(error)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Back to meeting library' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/meetings'));
  }
  warning.mockRestore();
  errorLog.mockRestore();
});

it('opens an existing note through its real recent link', async () => {
  const id = '00000000-0000-4000-8000-000000000002';
  const note = {
    id,
    title: 'Existing note',
    path: 'existing.md',
    created_at: '2026-10-23T00:00:00Z',
    updated_at: '2026-10-23T00:00:00Z',
    deleted_at: null,
    tags: [],
  };
  useAppStore.setState({ notes: [note] });
  vi.mocked(invoke).mockResolvedValueOnce({ note, markdown: 'Existing content' });
  setup();
  fireEvent.click(await screen.findByRole('link', { name: /^Existing note/ }));
  expect(await screen.findByText('Working note editor')).toBeInTheDocument();
  expect(invoke).toHaveBeenCalledWith('get_note', { id });
});
it('retries a temporarily unavailable note without leaving the shell', async () => {
  const router = setup();
  await screen.findByRole('button', { name: 'Activity map' });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  const id = '00000000-0000-4000-8000-000000000003';
  vi.mocked(invoke).mockRejectedValueOnce('temporary read failure');
  await act(async () => {
    await router.navigate({ to: '/notes/$noteId', params: { noteId: id } });
  });
  await screen.findByRole('heading', { name: 'Note unavailable' });
  vi.mocked(invoke).mockResolvedValueOnce({
    note: { id, title: 'Recovered note' },
    markdown: 'Recovered content',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Working note editor')).toBeInTheDocument();
  warning.mockRestore();
  errorLog.mockRestore();
});
it('keeps Home recent links inside the memory router', async () => {
  const id = '00000000-0000-4000-8000-000000000004';
  const note = {
    id,
    title: 'Home recent',
    path: 'home.md',
    created_at: '2026-10-23T00:00:00Z',
    updated_at: '2026-10-23T00:00:00Z',
    deleted_at: null,
    tags: [],
  };
  useAppStore.setState({ notes: [note] });
  const router = setup();
  await screen.findByRole('button', { name: 'Activity map' });
  await waitFor(() => expect(router.state.location.pathname).toBe('/home'));
  vi.mocked(invoke).mockResolvedValueOnce({ note, markdown: 'Home note' });
  fireEvent.click(screen.getAllByRole('link', { name: /Home recent/ }).at(-1)!);
  expect(await screen.findByText('Working note editor')).toBeInTheDocument();
  expect(router.state.location.pathname).toBe(`/notes/${id}`);
});
it('gives an empty-title Home note an accessible name and opens its real UUID', async () => {
  const id = '00000000-0000-4000-8000-000000000005';
  const note = {
    id,
    title: '',
    path: 'empty.md',
    created_at: '2026-10-23T00:00:00Z',
    updated_at: '2026-10-23T00:00:00Z',
    deleted_at: null,
    tags: [],
  };
  useAppStore.setState({ notes: [note] });
  const router = setup();
  await screen.findByRole('button', { name: 'Activity map' });
  await waitFor(() => expect(router.state.location.pathname).toBe('/home'));
  vi.mocked(invoke).mockResolvedValueOnce({ note, markdown: '' });
  const recent = within(screen.getByRole('main')).getByRole('link', { name: /untitled/i });
  fireEvent.click(recent);
  expect(await screen.findByText('Working note editor')).toBeInTheDocument();
  expect(router.state.location.pathname).toBe(`/notes/${id}`);
  expect(invoke).toHaveBeenCalledWith('get_note', { id });
});
