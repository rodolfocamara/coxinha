import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { useAppStore } from '../../lib/store';
import { boardSession, resetBoardSessionForTests } from '../board/persistence';
import { createBackend, type Backend } from './testing';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  navigate: vi.fn(async () => {}),
  params: {} as { noteId?: string },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => mocks.params,
}));
vi.mock('../../lib/useTheme', () => ({ useResolvedTheme: () => 'dark' }));
vi.mock('@xyflow/react', async () => {
  const { ReactFlowStub } = await import('./testing');
  return {
    ReactFlow: ReactFlowStub,
    Background: () => null,
    Controls: () => null,
    Panel: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    useReactFlow: () => ({ zoomIn: vi.fn(), zoomOut: vi.fn(), zoomTo: vi.fn(), fitView: vi.fn() }),
    useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    MiniMap: () => null,
    Handle: () => null,
    NodeResizer: () => null,
    BaseEdge: () => null,
    getBezierPath: () => [''],
    useInternalNode: () => undefined,
    Position: { Left: 'left', Right: 'right' },
  };
});
vi.mock('../notes/NoteEditor', () => ({
  NoteLoadingSkeleton: () => <p>loading note</p>,
  NoteEditor: (props: { noteId: string }) => (
    <section data-testid="note-editor" data-note-id={props.noteId} />
  ),
}));

import { WorkspaceRoute } from './WorkspaceRoute';

let backend: Backend;
const mount = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <WorkspaceRoute />
    </QueryClientProvider>
  );

beforeEach(async () => {
  vi.clearAllMocks();
  resetBoardSessionForTests();
  backend = createBackend(mocks.invoke);
  useAppStore.setState({ notes: backend.notes });
  await i18n.changeLanguage('pt-BR');
});
afterEach(async () => {
  cleanup();
  await boardSession.flush().catch(() => {});
  await i18n.changeLanguage('en');
});

it('gives an activity its files and links it to a meeting (spec 0105)', async () => {
  mocks.params = { noteId: 'n-api' };
  mount();
  const editor = await screen.findByRole('complementary', { name: /editor/i });
  expect(await within(editor).findByRole('region', { name: 'Arquivos' })).toBeInTheDocument();
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith('items_list', {
      item: { kind: 'activity', id: 'n-api', title: 'Contrato de API v2', date: null },
    })
  );
  expect(await within(editor).findByText('Nenhuma reunião vinculada.')).toBeInTheDocument();
  fireEvent.click(within(editor).getByRole('button', { name: 'Vincular reunião' }));
  const results = await within(editor).findByRole('list', { name: 'Reuniões encontradas' });
  fireEvent.click(within(results).getByRole('button', { name: /1:1 com a Rita/ }));
  await waitFor(() =>
    expect(backend.links).toEqual([{ session: 's-rita', note: 'n-api', createdAt: 'now' }])
  );
  const linked = await within(editor).findByRole('list', { name: 'Reuniões' });
  fireEvent.click(within(linked).getByRole('button', { name: '1:1 com a Rita' }));
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: '/meetings/$sessionId',
    params: { sessionId: 's-rita' },
  });
});

it("leaves a meeting's own note to the meeting", async () => {
  mocks.params = { noteId: 'n-rita' };
  mount();
  await screen.findByTestId('note-editor');
  expect(screen.queryByRole('region', { name: 'Arquivos' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Vincular reunião' })).toBeNull();
});
