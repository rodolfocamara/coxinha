import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Outlet, RouterProvider } from '@tanstack/react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import './lib/i18n';
import i18n from './lib/i18n';
import { createAppRouter } from './router';
import { useAppStore } from './lib/store';
import { resetBoardSessionForTests } from './features/board/persistence';
import { createBackend, fakeEditor, type Backend } from './features/workspace/testing';

// Spec 0096: notes live in the Workspace. Legacy `/notes` links redirect, a
// note opens in the side editor, and unreadable notes keep the shell usable.
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('./routes/__root', () => ({ RootLayout: () => <Outlet /> }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock('./lib/useTheme', () => ({ useResolvedTheme: () => 'dark' }));
vi.mock('@xyflow/react', async () => {
  const { ReactFlowStub } = await import('./features/workspace/testing');
  return {
    ReactFlow: ReactFlowStub,
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    Handle: () => null,
    NodeResizer: () => null,
    BaseEdge: () => null,
    getBezierPath: () => [''],
    useInternalNode: () => undefined,
    Position: { Left: 'left', Right: 'right' },
  };
});
vi.mock('./features/notes/NoteEditor', () => ({
  NoteLoadingSkeleton: () => null,
  NoteEditor: (props: {
    noteId: string;
    content: { markdown: string };
    overlay?: (e: unknown) => React.ReactNode;
  }) => (
    <section data-testid="note-editor" data-note-id={props.noteId}>
      Working note editor
      {props.overlay?.(fakeEditor(props.content.markdown))}
    </section>
  ),
}));

let backend: Backend;
beforeEach(async () => {
  vi.clearAllMocks();
  resetBoardSessionForTests();
  backend = createBackend(mocks.invoke);
  useAppStore.setState({ notes: backend.notes });
  await i18n.changeLanguage('en');
});

function setup(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(client);
  router.history.push(path);
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

it('redirects the legacy notes index to the Workspace board', async () => {
  const router = setup('/notes');
  await waitFor(() => expect(router.state.location.pathname).toBe('/workspace'));
  expect(await screen.findByTestId('node-c-api')).toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Notes off the board' })).toBeInTheDocument();
  expect(screen.queryByTestId('note-editor')).toBeNull();
});

it('opens a legacy note link in the side editor without placing it on the board', async () => {
  const router = setup('/notes/n-quick');
  await waitFor(() => expect(router.state.location.pathname).toBe('/workspace/n-quick'));
  expect(await screen.findByTestId('note-editor')).toHaveAttribute('data-note-id', 'n-quick');
  expect(mocks.invoke).toHaveBeenCalledWith('get_note', { id: 'n-quick' });
  expect(screen.getByRole('button', { name: 'Notes · 2 off the board' })).toBeInTheDocument();
  expect(backend.board.items.some((i) => i.noteId === 'n-quick')).toBe(false);
});

it('keeps the canvas mounted while moving between notes and closes the editor at /workspace', async () => {
  const router = setup('/workspace');
  const node = await screen.findByTestId('node-c-api');
  fireEvent.click(node);
  await waitFor(() => expect(router.state.location.pathname).toBe('/workspace/n-api'));
  expect(await screen.findByTestId('note-editor')).toHaveAttribute('data-note-id', 'n-api');
  expect(screen.getByTestId('node-c-api')).toBe(node);
  await act(async () => {
    await router.navigate({ to: '/workspace' });
  });
  await waitFor(() => expect(screen.queryByTestId('note-editor')).toBeNull());
  expect(screen.getByTestId('node-c-api')).toBe(node);
});

it('keeps navigation available when a stale or fixture note id cannot be opened', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const noteId of ['it-weekly-status', '00000000-0000-4000-8000-000000000009']) {
    const router = setup(`/workspace/${noteId}`);
    expect(await screen.findByRole('heading', { name: 'Note unavailable' })).toBeInTheDocument();
    expect(screen.getByText(`note ${noteId} not found`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open notes' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/workspace'));
    expect(await screen.findAllByTestId('node-c-api')).not.toHaveLength(0);
    document.body.innerHTML = '';
  }
  warning.mockRestore();
  errorLog.mockRestore();
});

it('retries a temporarily unavailable note without leaving the Workspace', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  const real = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementationOnce(async () => {
    throw 'temporary read failure';
  });
  mocks.invoke.mockImplementation(real);
  setup('/workspace/n-api');
  await screen.findByRole('heading', { name: 'Note unavailable' });
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByTestId('note-editor')).toHaveAttribute('data-note-id', 'n-api');
  expect(
    within(screen.getByTestId('note-editor')).getByText('Working note editor')
  ).toBeInTheDocument();
  warning.mockRestore();
  errorLog.mockRestore();
});
