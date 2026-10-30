import { changeControl } from '../../test/changeControl';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { emptyBoard, type Board } from './model';
const mocks = vi.hoisted(() => ({
  flowProps: {} as Record<string, unknown>,
  controlsProps: {} as Record<string, unknown>,
  navigate: vi.fn(),
  newNote: vi.fn(),
  update: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  get: vi.fn(),
  load: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn((_listener: () => void) => () => {}),
  notes: [{ id: 'note-1', title: 'Real note', path: 'notes/real.md' }],
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./locale', () => ({}));
vi.mock('./editor/CanvasNote', () => ({
  CanvasNote: ({
    noteId,
    editing,
    edit,
    close,
  }: {
    noteId: string;
    editing: boolean;
    edit: () => void;
    close: () => void;
  }) =>
    editing ? (
      <aside aria-label="editor" data-note-id={noteId}>
        <button onClick={close}>close-editor</button>
      </aside>
    ) : (
      <div>
        <p>Complete activity body</p>
        <button onClick={edit}>editActivity: Real note</button>
      </div>
    ),
}));
vi.mock('../../lib/useTheme', () => ({ useResolvedTheme: () => 'dark' }));
vi.mock('../../lib/store', () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({ notes: mocks.notes, newNote: mocks.newNote }),
}));
vi.mock('./persistence', () => ({
  boardSession: { ...mocks, dirty: () => false, error: () => null },
}));
vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: {
    children: React.ReactNode;
    nodes: { id: string; type: string; data: unknown; selected: boolean }[];
    nodeTypes: Record<string, React.ComponentType<any>>;
  }) => {
    mocks.flowProps = props;
    return (
      <div>
        {props.nodes.map((node) => {
          const Component = props.nodeTypes[node.type];
          return (
            <div key={node.id} data-testid={`node-${node.id}`}>
              <Component data={node.data} selected={node.selected} />
            </div>
          );
        })}
        {props.children}
      </div>
    );
  },
  Background: () => null,
  Controls: (props: Record<string, unknown>) => {
    mocks.controlsProps = props;
    return null;
  },
  Handle: () => null,
  NodeResizer: () => null,
  MiniMap: () => null,
  Position: { Left: 'left', Right: 'right' },
}));
import { ActivityBoard } from './ActivityBoard';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockReturnValue(emptyBoard());
  const listeners = new Set<() => void>();
  mocks.subscribe.mockImplementation((listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  });
  mocks.update.mockImplementation((board: Board) => {
    mocks.get.mockReturnValue(board);
    listeners.forEach((listener) => listener());
  });
});
it('adds an existing Markdown note without creating or deleting a note', () => {
  render(<ActivityBoard />);
  fireEvent.click(screen.getByText('addNote', { selector: 'summary' }));
  changeControl(screen.getByRole('combobox', { name: 'addNote' }), {
    target: { value: 'note-1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'addNote' }));
  expect(mocks.newNote).not.toHaveBeenCalled();
  expect(mocks.update.mock.calls[0][0].items[0]).toMatchObject({
    noteId: 'note-1',
    notePath: 'notes/real.md',
  });
});
it('creates the real note before adding its card', async () => {
  mocks.newNote.mockResolvedValue(mocks.notes[0]);
  render(<ActivityBoard />);
  fireEvent.click(screen.getByRole('button', { name: 'newNote' }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalled());
  expect(mocks.update.mock.calls[0][0].items[0].noteId).toBe('note-1');
  expect(screen.getByRole('complementary', { name: 'editor' })).toHaveAttribute(
    'data-note-id',
    'note-1'
  );
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'remove' })).not.toBeInTheDocument();
});
it('opens real notes and removes only their visual card through keyboard reachable controls', async () => {
  const b: Board = {
    ...emptyBoard(),
    items: [
      {
        id: 'card',
        kind: 'card',
        x: 0,
        y: 0,
        width: 230,
        height: 100,
        color: 'blue',
        label: '',
        noteId: 'note-1',
        notePath: 'notes/real.md',
      },
    ],
  };
  mocks.get.mockReturnValue(b);
  render(<ActivityBoard />);
  fireEvent.click(screen.getByRole('button', { name: 'outline' }));
  fireEvent.click(screen.getByRole('button', { name: 'Real note' }));
  fireEvent.click(screen.getByRole('button', { name: 'open' }));
  expect(await screen.findByRole('complementary', { name: 'editor' })).toHaveAttribute(
    'data-note-id',
    'note-1'
  );
  expect(mocks.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'close-editor' }));
  fireEvent.click(screen.getByRole('button', { name: 'inspector' }));
  fireEvent.click(screen.getByRole('button', { name: 'remove' }));
  expect(mocks.update.mock.calls[0][0].items).toEqual([]);
});

it('resolves a rebuilt note UUID by its canonical Markdown path', async () => {
  mocks.get.mockReturnValue({
    ...emptyBoard(),
    items: [
      {
        id: 'card',
        kind: 'card',
        x: 0,
        y: 0,
        width: 230,
        height: 100,
        color: 'blue',
        label: '',
        noteId: 'old-index-uuid',
        notePath: 'notes/real.md',
      },
    ],
  });
  render(<ActivityBoard />);
  fireEvent.click(screen.getByRole('button', { name: 'outline' }));
  fireEvent.click(screen.getByRole('button', { name: 'Real note' }));
  fireEvent.click(screen.getByRole('button', { name: 'open' }));
  expect(await screen.findByRole('complementary', { name: 'editor' })).toHaveAttribute(
    'data-note-id',
    'note-1'
  );
  expect(mocks.navigate).not.toHaveBeenCalled();
});

const existingCard = () => ({
  ...emptyBoard(),
  items: [
    {
      id: 'card',
      kind: 'card' as const,
      x: 12,
      y: 24,
      width: 230,
      height: 100,
      color: 'blue' as const,
      label: '',
      noteId: 'note-1',
      notePath: 'notes/real.md',
    },
  ],
});
it('opens an editor without waiting for board persistence and flushes on route cleanup', async () => {
  mocks.get.mockReturnValue(existingCard());
  const view = render(<ActivityBoard />);
  fireEvent.click(screen.getByRole('button', { name: 'outline' }));
  fireEvent.click(screen.getByRole('button', { name: 'Real note' }));
  fireEvent.click(screen.getByText('geometry', { selector: 'summary' }));
  changeControl(screen.getByRole('spinbutton', { name: 'x' }), { target: { value: '90' } });
  expect(mocks.update).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'open' }));
  expect(screen.getByRole('complementary', { name: 'editor' })).toBeVisible();
  expect(mocks.navigate).not.toHaveBeenCalled();
  const calls = mocks.flush.mock.calls.length;
  view.unmount();
  expect(mocks.flush).toHaveBeenCalledTimes(calls + 1);
});
it('retains controlled selection changes emitted by ReactFlow and accepts keyboard position changes', () => {
  mocks.get.mockReturnValue(existingCard());
  render(<ActivityBoard />);
  const changes = () => mocks.flowProps.onNodesChange as (changes: unknown[]) => void;
  act(() => changes()([{ type: 'select', id: 'card', selected: true }]));
  expect((mocks.flowProps.nodes as { selected: boolean }[])[0].selected).toBe(true);
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'inspector' }));
  expect(screen.getByRole('button', { name: 'open' })).toBeEnabled();
  act(() => changes()([{ type: 'position', id: 'card', position: { x: 17, y: 24 } }]));
  expect(mocks.update.mock.calls[0][0].items[0].x).toBe(17);
  expect(mocks.flowProps.zoomOnDoubleClick).toBe(false);
  expect(mocks.flowProps.fitViewOptions).toEqual({ maxZoom: 1 });
  expect(mocks.controlsProps.fitViewOptions).toEqual({ maxZoom: 1 });
});

it('gives the canvas priority while keeping outline and inspector keyboard reachable', () => {
  mocks.get.mockReturnValue(existingCard());
  render(<ActivityBoard />);
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  const toggle = screen.getByRole('button', { name: 'inspector' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'outline' }));
  expect(screen.getByRole('button', { name: 'Real note' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Real note' }));
  expect(screen.getByRole('button', { name: 'open' })).toBeVisible();
  expect(screen.getByText('geometry').closest('details')).not.toHaveAttribute('open');
  expect(
    screen.getByText('dependencies', { selector: 'summary' }).closest('details')
  ).not.toHaveAttribute('open');
  const close = screen.getByRole('button', { name: 'hideInspector' });
  close.focus();
  fireEvent.click(close);
  expect(toggle).toHaveFocus();
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  expect(mocks.flowProps.colorMode).toBe('dark');
});
it('creates an area with its geometry preserved and opens contextual details', () => {
  render(<ActivityBoard />);
  fireEvent.click(screen.getByRole('button', { name: 'area' }));
  expect(mocks.update.mock.calls[0][0].items[0]).toMatchObject({
    kind: 'area',
    width: 580,
    height: 350,
  });
  expect(screen.getByRole('button', { name: 'inspector' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
});

it('keeps canonical width but lets complete content determine activity height', () => {
  mocks.get.mockReturnValue(existingCard());
  const view = render(<ActivityBoard />);
  const first = () =>
    (
      mocks.flowProps.nodes as {
        width: number;
        height: number;
        measured: { width: number; height: number };
      }[]
    )[0];
  expect(first()).toMatchObject({ width: 230, height: undefined });
  act(() =>
    (mocks.flowProps.onNodesChange as (changes: unknown[]) => void)([
      { type: 'select', id: 'card', selected: true },
    ])
  );
  expect(first().measured).toEqual({ width: 230, height: 100 });
  act(() =>
    (mocks.flowProps.onNodesChange as (changes: unknown[]) => void)([
      { type: 'dimensions', id: 'card', dimensions: { width: 230, height: 340 } },
    ])
  );
  expect(mocks.update).not.toHaveBeenCalled();
  const board = existingCard();
  board.items[0].width = 310;
  mocks.get.mockReturnValue(board);
  view.rerender(<ActivityBoard />);
  expect(first()).toMatchObject({ width: 310, height: undefined });
});

it('opens card double-click in the same board and restores the triggering focus on close', async () => {
  mocks.get.mockReturnValue(existingCard());
  render(<ActivityBoard />);
  const trigger = screen.getByRole('button', { name: 'newNote' });
  trigger.focus();
  act(() =>
    (mocks.flowProps.onNodeDoubleClick as (event: unknown, node: { id: string }) => void)(
      {},
      { id: 'card' }
    )
  );
  expect(screen.getByRole('complementary', { name: 'editor' })).toHaveAttribute(
    'data-note-id',
    'note-1'
  );
  expect(screen.getByRole('region', { name: 'title' })).toBeVisible();
  expect(mocks.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'close-editor' }));
  expect(trigger).toHaveFocus();
});

it('keeps the first card click and keyboard selection free of an inspector covering the second click', () => {
  mocks.get.mockReturnValue(existingCard());
  render(<ActivityBoard />);
  const click = () =>
    (mocks.flowProps.onNodeClick as (event: unknown, node: { id: string }) => void)(
      {},
      { id: 'card' }
    );
  const select = () =>
    (mocks.flowProps.onNodesChange as (changes: unknown[]) => void)([
      { type: 'select', id: 'card', selected: true },
    ]);
  act(select);
  expect(screen.queryByRole('complementary')).toBeNull();
  act(click);
  expect(screen.getByRole('button', { name: 'inspector' })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  expect(screen.queryByRole('complementary')).toBeNull();
  act(click);
  act(() =>
    (mocks.flowProps.onNodeDoubleClick as (event: unknown, node: { id: string }) => void)(
      {},
      { id: 'card' }
    )
  );
  expect(screen.getByRole('complementary', { name: 'editor' })).toBeVisible();
  expect(mocks.navigate).not.toHaveBeenCalled();
});
it('retains explicit property access after selecting a card without opening the inspector', () => {
  mocks.get.mockReturnValue(existingCard());
  render(<ActivityBoard />);
  act(() =>
    (mocks.flowProps.onNodeClick as (event: unknown, node: { id: string }) => void)(
      {},
      { id: 'card' }
    )
  );
  fireEvent.click(screen.getByRole('button', { name: 'inspector' }));
  expect(screen.getByRole('button', { name: 'open' })).toBeEnabled();
  expect(screen.getByText('geometry')).toBeVisible();
});

it('keeps inspector expansion truthful while editing and supports an explicit switch to properties', () => {
  mocks.get.mockReturnValue(existingCard());
  render(<ActivityBoard />);
  act(() =>
    (mocks.flowProps.onNodeDoubleClick as (event: unknown, node: { id: string }) => void)(
      {},
      { id: 'card' }
    )
  );
  const toggle = screen.getByRole('button', { name: 'inspector' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('complementary', { name: 'editor' })).toBeVisible();
  fireEvent.click(toggle);
  expect(screen.queryByRole('complementary', { name: 'editor' })).toBeNull();
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'open' })).toBeVisible();
});

it('shows the activity container immediately and edits inside that same node after creation', async () => {
  let resolve!: (value: unknown) => void;
  mocks.newNote.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  render(<ActivityBoard />);
  fireEvent.click(screen.getByRole('button', { name: 'newNote' }));
  const placeholder = screen.getByText('creating').closest('[data-testid]')!;
  const id = placeholder.getAttribute('data-testid');
  expect(mocks.update).not.toHaveBeenCalled();
  await act(async () => resolve(mocks.notes[0]));
  expect(screen.getByTestId(id!)).toContainElement(
    screen.getByRole('complementary', { name: 'editor' })
  );
  expect(mocks.update.mock.calls[0][0].items[0].progress).toBe(0);
  expect(mocks.navigate).not.toHaveBeenCalled();
});
it('preserves a failed placeholder for explicit retry without persisting a phantom reference', async () => {
  mocks.newNote.mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(mocks.notes[0]);
  render(<ActivityBoard />);
  fireEvent.click(screen.getByRole('button', { name: 'newNote' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('createFailed');
  expect(mocks.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'retry' }));
  await screen.findByRole('complementary', { name: 'editor' });
  expect(mocks.update).toHaveBeenCalledTimes(1);
});
it('keeps selected areas below cards and persists progress without navigating', () => {
  const b = existingCard();
  mocks.get.mockReturnValue({
    ...b,
    items: [...b.items, { ...b.items[0], id: 'area', kind: 'area', noteId: null, notePath: null }],
  });
  render(<ActivityBoard />);
  act(() =>
    (mocks.flowProps.onNodesChange as (changes: unknown[]) => void)([
      { type: 'select', id: 'area', selected: true },
    ])
  );
  const nodes = mocks.flowProps.nodes as { id: string; zIndex: number }[];
  expect(nodes.find((n) => n.id === 'area')!.zIndex).toBeLessThan(
    nodes.find((n) => n.id === 'card')!.zIndex
  );
  expect(mocks.flowProps.elevateNodesOnSelect).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'editActivity: Real note' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'progress' }), {
    target: { value: '75' },
  });
  expect(mocks.update.mock.calls.at(-1)![0].items[0].progress).toBe(75);
  expect(screen.getAllByRole('progressbar')[0]).toHaveAttribute('aria-valuenow', '75');
});

it('edits only the selected visual container when two activities reference the same note', () => {
  const b = existingCard();
  mocks.get.mockReturnValue({ ...b, items: [...b.items, { ...b.items[0], id: 'second', x: 400 }] });
  render(<ActivityBoard />);
  fireEvent.click(screen.getAllByRole('button', { name: 'editActivity: Real note' })[1]);
  const editor = screen.getByRole('complementary', { name: 'editor' });
  expect(screen.getByTestId('node-second')).toContainElement(editor);
  expect(screen.getByTestId('node-card')).not.toContainElement(editor);
});
