import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { useAppStore } from '../../lib/store';
import { boardSession, resetBoardSessionForTests } from '../board/persistence';
import { createBackend, fakeEditor, flow, type Backend } from './testing';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  navigate: vi.fn(async () => {}),
  params: {} as { noteId?: string },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true }));
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
  NoteEditor: (props: {
    noteId: string;
    variant: string;
    content: { markdown: string };
    overlay?: (editor: unknown) => React.ReactNode;
    onDeleted?: () => void;
  }) => (
    <section data-testid="note-editor" data-note-id={props.noteId} data-variant={props.variant}>
      <div className="relative">{props.overlay?.(fakeEditor(props.content.markdown))}</div>
      <button type="button" onClick={props.onDeleted}>
        delete-note-file
      </button>
    </section>
  ),
}));

import { WorkspaceRoute } from './WorkspaceRoute';

let backend: Backend;
const board = () => boardSession.get()!;
const itemOf = (id: string) => board().items.find((i) => i.id === id)!;

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <WorkspaceRoute />
    </QueryClientProvider>
  );
  return {
    ...view,
    rerender: () =>
      view.rerender(
        <QueryClientProvider client={client}>
          <WorkspaceRoute />
        </QueryClientProvider>
      ),
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetBoardSessionForTests();
  mocks.params = {};
  backend = createBackend(mocks.invoke);
  useAppStore.setState({ notes: backend.notes });
  await i18n.changeLanguage('pt-BR');
});
afterEach(async () => {
  cleanup();
  await boardSession.flush().catch(() => {});
  await i18n.changeLanguage('en');
});

it('lists off-board notes in the drawer and places one on the board', async () => {
  mount();
  const offBoard = await screen.findByRole('list', { name: 'Notas fora do quadro' });
  expect(screen.getByText('Fora do quadro · 2')).toBeInTheDocument();
  expect(within(offBoard).getByText('1:1 com a Rita')).toBeInTheDocument();
  expect(within(offBoard).getByText('Ideia rápida')).toBeInTheDocument();
  await waitFor(() => expect(within(offBoard).getByText(/nota da reunião/)).toBeInTheDocument());

  fireEvent.click(
    within(offBoard).getByRole('button', { name: 'Colocar no quadro: 1:1 com a Rita' })
  );

  const placed = board().items.find((i) => i.noteId === 'n-rita')!;
  expect(placed).toMatchObject({ kind: 'text', notePath: 'notes/n-rita.md', parentId: null });
  expect(mocks.invoke).not.toHaveBeenCalledWith('create_note', expect.anything());
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: '/workspace/$noteId',
    params: { noteId: 'n-rita' },
  });
  expect(await screen.findByTestId('note-editor')).toHaveAttribute('data-note-id', 'n-rita');
  // The editor collapsed the drawer to its tab: one note left off the board.
  expect(screen.getByRole('button', { name: 'Notas · 1 fora do quadro' })).toHaveAttribute(
    'aria-expanded',
    'false'
  );

  // "veio da reunião X" opens the meeting.
  fireEvent.click(screen.getByRole('button', { name: '1:1 com a Rita' }));
  expect(mocks.navigate).toHaveBeenLastCalledWith(
    expect.objectContaining({ to: '/meetings/$sessionId', params: { sessionId: 's-rita' } })
  );
});

it('promote and demote change only the kind and keep the note id and path', async () => {
  mount();
  const card = await screen.findByTestId('node-t-idea');
  const before = { ...itemOf('t-idea') };
  fireEvent.click(within(card).getByRole('button', { name: 'Virar atividade' }));
  expect(itemOf('t-idea')).toEqual({ ...before, kind: 'card', progress: 0 });
  expect(card.querySelector('.ws-card')).toHaveClass('cx-card-pop');
  expect(screen.getByRole('radio', { name: 'Atividade' })).toHaveAttribute('aria-checked', 'true');

  fireEvent.click(screen.getByRole('radio', { name: 'Nota' }));
  expect(itemOf('t-idea')).toEqual({ ...before, kind: 'text', progress: 0 });
  // The file and its text never change.
  expect(mocks.invoke).not.toHaveBeenCalledWith('update_note', expect.anything());
  expect(mocks.invoke).not.toHaveBeenCalledWith('create_note', expect.anything());
});

it('turns a checklist line into a linked activity under its note and marks it "no quadro"', async () => {
  mount();
  fireEvent.click(await screen.findByTestId('node-c-api'));
  const line = await screen.findByRole('button', {
    name: 'Criar atividade: Revisão de segurança na quinta',
  });
  expect(screen.queryByRole('button', { name: 'Criar atividade: Validar escopo' })).toBeNull();
  fireEvent.click(line);

  const linked = await screen.findByRole('button', {
    name: 'Revisão de segurança na quinta já está no quadro',
  });
  const source = itemOf('c-api');
  const created = board().items.find((i) => i.kind === 'card' && !fixtureIds.includes(i.id))!;
  expect(mocks.invoke).toHaveBeenCalledWith('update_note', {
    id: created.noteId,
    content: expect.stringMatching(/^# Revisão de segurança na quinta\n/),
  });
  expect(created).toMatchObject({ parentId: 'a-crm', progress: 0 });
  expect(created.y).toBeGreaterThan(source.y + source.height);
  for (const other of board().items.filter((i) => i.kind !== 'area' && i.id !== created.id))
    expect(
      created.x < other.x + other.width &&
        created.x + created.width > other.x &&
        created.y < other.y + other.height &&
        created.y + created.height > other.y
    ).toBe(false);
  expect(board().edges).toContainEqual(
    expect.objectContaining({ source: 'c-api', target: created.id })
  );
  expect(screen.getByTestId(`edge-c-api-${created.id}`)).toHaveAttribute('data-fresh', 'true');
  // The source stays open; "no quadro" selects the new card.
  expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'n-api');
  fireEvent.click(linked);
  await waitFor(() =>
    expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', created.noteId!)
  );
});
const fixtureIds = ['a-crm', 'c-integ', 'c-api', 'c-comm', 't-idea'];

it('opens the side editor from /workspace/$noteId without placing an off-board note', async () => {
  mocks.params = { noteId: 'n-quick' };
  mount();
  expect(await screen.findByTestId('note-editor')).toHaveAttribute('data-note-id', 'n-quick');
  expect(screen.getByText(/Esta nota está fora do quadro/)).toBeInTheDocument();
  expect(board().items.some((i) => i.noteId === 'n-quick')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /Notas · 2 fora do quadro/ }));
  expect(
    within(screen.getByRole('list', { name: 'Notas fora do quadro' })).getByText('Ideia rápida')
  ).toBeInTheDocument();
  expect(mocks.invoke).toHaveBeenCalledWith('get_note', { id: 'n-quick' });
});

it('follows URL changes and selects the item that shows the note', async () => {
  const view = mount();
  await screen.findByTestId('node-c-api');
  expect(screen.queryByTestId('note-editor')).toBeNull();
  mocks.params = { noteId: 'n-api' };
  view.rerender();
  expect(await screen.findByTestId('note-editor')).toHaveAttribute('data-note-id', 'n-api');
  expect(screen.getByTestId('node-c-api')).toHaveClass('selected');
  expect(screen.getByRole('slider', { name: 'Progresso' })).toHaveValue('55');
});

it('has exactly one editor: the side panel, never inside a canvas card', async () => {
  mount();
  fireEvent.click(await screen.findByTestId('node-c-api'));
  await screen.findByTestId('note-editor');
  expect(screen.getAllByTestId('note-editor')).toHaveLength(1);
  expect(screen.getByTestId('note-editor')).toHaveAttribute('data-variant', 'workspace');
  for (const node of document.querySelectorAll('.react-flow__node'))
    expect(
      node.querySelector('[contenteditable], textarea, [data-testid="note-editor"]')
    ).toBeNull();
  expect(screen.getByRole('complementary', { name: 'Editor da nota' })).toBeInTheDocument();
});

it('names every card for the shared view transition with Hoje', async () => {
  mount();
  const node = await screen.findByTestId('node-c-api');
  expect(node.style.viewTransitionName).toBe('card-c-api');
  expect(node.getAttribute('style')).toContain('view-transition-class: card');
});

it('reaches cards and the drawer by keyboard; Escape closes the editor and returns focus', async () => {
  mount();
  const node = await screen.findByRole('button', { name: 'Contrato de API v2, atividade 55%' });
  node.focus();
  fireEvent.keyDown(node, { key: 'Enter' });
  expect(await screen.findByTestId('note-editor')).toHaveAttribute('data-note-id', 'n-api');
  const tab = screen.getByRole('button', { name: 'Notas · 2 fora do quadro' });
  fireEvent.click(tab);
  const outline = screen.getByRole('list', { name: 'Itens no quadro' });
  fireEvent.click(within(outline).getByRole('button', { name: /Comunicar áreas/ }));
  expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'n-comm');
  fireEvent.click(within(outline).getByRole('button', { name: /Migração do CRM/ }));
  expect(screen.getByRole('textbox', { name: 'Nome da área' })).toHaveValue('Migração do CRM');

  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Nome da área' }), { key: 'Escape' });
  expect(screen.queryByRole('complementary', { name: 'Editor da nota' })).toBeNull();
  expect(document.activeElement).toBe(node);
});

it('updates the card live while dragging progress and commits on release', async () => {
  mount();
  fireEvent.click(await screen.findByTestId('node-c-api'));
  const slider = await screen.findByRole('slider', { name: 'Progresso' });
  fireEvent.input(slider, { target: { value: '80' } });
  expect(screen.getByTestId('node-c-api').querySelector('[data-progress-label]')).toHaveTextContent(
    '80%'
  );
  expect(itemOf('c-api').progress).toBe(55);
  fireEvent.change(slider, { target: { value: '80' } });
  expect(itemOf('c-api').progress).toBe(80);
});

it('keeps edits on a save conflict, exports a recovery copy and reloads only after confirmation', async () => {
  backend.saveError = 'board revision conflict';
  mount();
  const card = await screen.findByTestId('node-t-idea');
  fireEvent.click(within(card).getByRole('button', { name: 'Virar atividade' }));
  const alert = await screen.findByText(/Outro processo mudou o quadro/, undefined, {
    timeout: 3000,
  });
  expect(itemOf('t-idea').kind).toBe('card');
  expect(screen.getByText('Não salvo')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Salvar cópia de recuperação' }));
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith('board_export_recovery', {
      board: expect.objectContaining({ revision: 1 }),
    })
  );
  expect(await screen.findByText(/Cópia salva no vault/)).toBeInTheDocument();
  expect(alert).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Recarregar o quadro salvo' }));
  const dialog = screen.getByRole('alertdialog');
  expect(mocks.invoke.mock.calls.filter(([c]) => c === 'board_load')).toHaveLength(1);
  backend.saveError = null;
  fireEvent.click(within(dialog).getByRole('button', { name: 'Descartar e recarregar' }));
  await waitFor(() => expect(itemOf('t-idea').kind).toBe('text'));
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('offers retry when the board cannot be loaded', async () => {
  backend.loadError = 'disk unavailable';
  mount();
  const retry = await screen.findByRole('button', { name: 'Tentar de novo' });
  expect(screen.getByText(/Não foi possível abrir o quadro/)).toBeInTheDocument();
  fireEvent.click(retry);
  expect(await screen.findByTestId('node-c-api')).toBeInTheDocument();
});

it('shows the empty state and creates the first activity from it', async () => {
  backend.board = { version: 3, revision: 0, items: [], edges: [] };
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Criar a primeira atividade' }));
  await waitFor(() => expect(board().items).toHaveLength(1));
  expect(board().items[0]).toMatchObject({ kind: 'card', progress: 0 });
  expect(await screen.findByTestId('note-editor')).toHaveAttribute(
    'data-note-id',
    board().items[0].noteId!
  );
});

it('removes the cards of a deleted note and closes the editor', async () => {
  mount();
  fireEvent.click(await screen.findByTestId('node-c-api'));
  fireEvent.click(await screen.findByRole('button', { name: 'delete-note-file' }));
  expect(board().items.some((i) => i.noteId === 'n-api')).toBe(false);
  expect(board().edges.some((e) => e.source === 'c-api' || e.target === 'c-api')).toBe(false);
  expect(screen.queryByTestId('note-editor')).toBeNull();
});

it('Delete removes only the selected dependency, never an item', async () => {
  mount();
  await screen.findByTestId('node-c-api');
  const edge = { id: 'e-1', source: 'c-integ', target: 'c-api' };
  await expect(
    flow.props.onBeforeDelete({ nodes: [{ id: 'c-api' }], edges: [edge] })
  ).resolves.toEqual({ nodes: [], edges: [edge] });
  act(() => flow.props.onEdgesDelete([edge]));
  expect(board().edges.map((e) => e.id)).toEqual(['e-2']);
  expect(board().items).toHaveLength(5);
});

it('links a dependency from the editor and removes it from its chip', async () => {
  mount();
  fireEvent.click(await screen.findByTestId('node-c-comm'));
  await screen.findByTestId('note-editor');
  expect(screen.getByRole('button', { name: 'Contrato de API v2' })).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Remover a dependência de Contrato de API v2' })
  );
  expect(board().edges.map((e) => e.id)).toEqual(['e-1']);
  expect(screen.getByText('nada')).toBeInTheDocument();
});

it('creates a note from the toolbar at a free spot and focuses its editor', async () => {
  mount();
  await screen.findByTestId('node-c-api');
  fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
  await waitFor(() => expect(board().items).toHaveLength(6));
  const created = board().items[5];
  expect(created).toMatchObject({ kind: 'text' });
  expect(await screen.findByTestId('note-editor')).toHaveAttribute('data-note-id', created.noteId!);
  expect(screen.getByRole('radio', { name: 'Nota' })).toHaveAttribute('aria-checked', 'true');
});

it('searches note content from the drawer and drops a found note onto the canvas', async () => {
  backend.bodies['n-quick'] = '# Ideia rápida\n\nfila de leads parada\n';
  mount();
  await screen.findByTestId('node-c-api');
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar em todas as notas' }), {
    target: { value: 'fila de leads' },
  });
  const offBoard = screen.getByRole('list', { name: 'Notas fora do quadro' });
  await waitFor(() => expect(within(offBoard).getByText('Ideia rápida')).toBeInTheDocument());
  expect(within(offBoard).queryByText('1:1 com a Rita')).toBeNull();
  expect(mocks.invoke).toHaveBeenCalledWith('search_notes', { query: 'fila de leads' });

  const data = new Map<string, string>();
  const row = within(offBoard).getByText('Ideia rápida').closest('li')!;
  const dataTransfer = {
    types: [] as string[],
    setData: (type: string, value: string) => {
      data.set(type, value);
      dataTransfer.types.push(type);
    },
    getData: (type: string) => data.get(type) ?? '',
    effectAllowed: '',
  };
  fireEvent.dragStart(row, { dataTransfer });
  const canvas = document.querySelector('.ws-canvas')!;
  fireEvent.dragOver(canvas, { dataTransfer });
  fireEvent.drop(canvas, { dataTransfer, clientX: 900, clientY: 520 });
  const dropped = board().items.find((i) => i.noteId === 'n-quick')!;
  expect(dropped).toMatchObject({ kind: 'text', notePath: 'notes/n-quick.md' });
  expect(Number.isFinite(dropped.x) && Number.isFinite(dropped.y)).toBe(true);
});
