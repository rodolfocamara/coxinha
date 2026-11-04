/* The other Workspace suites stub React Flow, and the stub hid that the real one
   prevents every key it watches: Delete reached no item for months. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { useAppStore } from '../../lib/store';
import { boardSession, resetBoardSessionForTests } from '../board/persistence';
import { createBackend, fakeEditor } from './testing';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => async () => {},
  useParams: () => ({}),
}));
vi.mock('../../lib/useTheme', () => ({ useResolvedTheme: () => 'dark' }));
vi.mock('../notes/NoteEditor', () => ({
  NoteLoadingSkeleton: () => null,
  NoteEditor: (props: {
    content: { markdown: string };
    overlay?: (editor: unknown) => React.ReactNode;
  }) => <div data-testid="note-editor">{props.overlay?.(fakeEditor(props.content.markdown))}</div>,
}));

import { WorkspaceRoute } from './WorkspaceRoute';

// jsdom has no layout; React Flow only needs these to exist.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);
vi.stubGlobal(
  'DOMMatrixReadOnly',
  class {
    m22 = 1;
  }
);

const ids = () => boardSession.get()!.items.map((i) => i.id);
const node = (id: string) =>
  document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WorkspaceRoute />
    </QueryClientProvider>
  );
  await waitFor(() => expect(node('c-api')).not.toBeNull());
}

/** A key press as the browser sends it: from the focused element up to window. */
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
    fireEvent.keyUp(document.activeElement ?? document.body, { key, ...init });
  });

beforeEach(async () => {
  vi.clearAllMocks();
  resetBoardSessionForTests();
  const backend = createBackend(mocks.invoke);
  useAppStore.setState({ notes: backend.notes });
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  cleanup();
  await boardSession.flush().catch(() => {});
});

it.each(['Delete', 'Backspace'])(
  '%s removes the selected card, and Ctrl+Z restores it',
  async (key) => {
    await mount();
    fireEvent.click(node('c-api'));
    await screen.findByTestId('note-editor');

    await press(key);
    await waitFor(() => expect(ids()).not.toContain('c-api'));

    await press('z', { ctrlKey: true });
    await waitFor(() => expect(ids()).toContain('c-api'));
  }
);

it('Delete removes a selected area and leaves its cards', async () => {
  await mount();
  fireEvent.click(node('a-crm'));
  await press('Delete');
  await waitFor(() => expect(ids()).not.toContain('a-crm'));
  expect(ids()).toContain('c-api');
});

it('Delete with nothing selected removes nothing', async () => {
  await mount();
  const before = ids();
  await press('Delete');
  expect(ids()).toEqual(before);
});

it('Delete in a text field edits the text and removes nothing', async () => {
  await mount();
  fireEvent.click(node('a-crm'));
  const field = await screen.findByRole('textbox', { name: /area name/i });
  field.focus();
  const before = ids();
  await press('Delete');
  expect(ids()).toEqual(before);
});
