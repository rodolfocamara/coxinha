import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { en, pt } from '@blocknote/core/locales';
import i18n from '../../lib/i18n';
import { editorFocusRequest, type EditorFocusRequest } from './editorFocusRequest';
import { NoteEditor } from './NoteEditor';
import type { NoteContent } from '../../lib/bindings';
import { deleteAfterPendingSaves } from '../../lib/noteSessions';
const mocks = vi.hoisted(() => ({
  dictionary: undefined as unknown,
  onChange: undefined as undefined | (() => void),
  backlinks: vi.fn(),
  delete: vi.fn(),
  duplicate: vi.fn(),
  navigate: vi.fn(),
  editor: {
    document: [],
    tryParseMarkdownToBlocks: vi.fn(async () => []),
    replaceBlocks: vi.fn(),
    blocksToMarkdownLossy: vi.fn(() => '# Keep my editable H1\nBody'),
    getBlock: vi.fn(),
    focus: vi.fn(),
    undo: vi.fn(),
  },
}));
vi.mock('@blocknote/core', () => ({ BlockNoteSchema: { create: vi.fn() }, defaultBlockSpecs: {} }));
vi.mock('@blocknote/react', () => ({
  useCreateBlockNote: (options: { dictionary?: unknown }) => {
    mocks.dictionary = options.dictionary;
    return mocks.editor;
  },
}));
vi.mock('@blocknote/shadcn', () => ({
  BlockNoteView: ({ onChange, editable }: { onChange: () => void; editable: boolean }) => {
    mocks.onChange = onChange;
    return <div data-testid="rich-text" data-editable={editable} />;
  },
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../../lib/store', () => ({
  useAppStore: (
    select: (s: {
      deleteNote: typeof mocks.delete;
      duplicateNote: typeof mocks.duplicate;
    }) => unknown
  ) => select({ deleteNote: mocks.delete, duplicateNote: mocks.duplicate }),
}));
vi.mock('../meetings/MeetingBlock', () => ({ meetingBlockSpec: {} }));
vi.mock('./BacklinksPanel', () => ({
  BacklinksPanel: () => {
    mocks.backlinks();
    return <aside aria-label="Backlinks" />;
  },
}));
vi.mock('../../lib/useTheme', () => ({ useResolvedTheme: () => 'light' }));
const content = {
  note: {
    id: 'embedded-note',
    title: 'Standalone title',
    tags: [],
    updated_at: '',
    path: 'notes/embedded.md',
    created_at: '',
  },
  markdown: '# Keep my editable H1\nBody',
} as NoteContent;
function mount(variant?: 'embedded' | 'standalone', focusRequest?: EditorFocusRequest) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NoteEditor
        noteId="embedded-note"
        content={content}
        variant={variant}
        focusRequest={focusRequest}
      />
    </QueryClientProvider>
  );
}
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.editor.tryParseMarkdownToBlocks.mockResolvedValue([]);
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await deleteAfterPendingSaves('embedded-note', async () => {});
  document.getElementById('workspace-sidebar')?.remove();
  await i18n.changeLanguage('en');
});
it('removes standalone heading and backlink chrome only when embedded, preserving editable Markdown exactly', async () => {
  mount('embedded');
  await waitFor(() =>
    expect(screen.getByTestId('rich-text')).toHaveAttribute('data-editable', 'true')
  );
  expect(screen.queryByRole('heading', { name: 'Standalone title' })).toBeNull();
  expect(screen.queryByRole('complementary', { name: 'Backlinks' })).toBeNull();
  expect(mocks.backlinks).not.toHaveBeenCalled();
  expect(mocks.editor.tryParseMarkdownToBlocks).toHaveBeenCalledWith(content.markdown);
  expect(mocks.editor.replaceBlocks).toHaveBeenCalledWith(mocks.editor.document, []);
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  expect(await screen.findByRole('menu', { name: 'Note actions' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: /^Duplicate/ })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: 'Move to Trash' })).toBeNull();
  expect(screen.getByRole('menuitem', { name: 'Copy page contents' })).toBeEnabled();
  expect(screen.getByRole('menuitemcheckbox', { name: 'Full width' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('menuitem', { name: /Undo/ }));
  expect(mocks.editor.undo).toHaveBeenCalledOnce();
});
it('keeps the default standalone heading, backlinks and editor dictionary behavior', async () => {
  mount();
  expect(await screen.findByRole('heading', { name: 'Standalone title' })).toBeInTheDocument();
  expect(screen.getByRole('complementary', { name: 'Backlinks' })).toBeInTheDocument();
  expect(mocks.dictionary).toBeUndefined();
  await waitFor(() => expect(mocks.editor.focus).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  expect(await screen.findByRole('menuitem', { name: /^Duplicate/ })).toBeEnabled();
  expect(screen.getByRole('menuitem', { name: 'Move to Trash' })).toBeEnabled();
  expect(screen.getByTestId('note-editor-surface').parentElement).not.toHaveClass(
    'cx-note-embedded'
  );
});
it('does not steal sidebar keyboard focus when the embedded editor finishes loading', async () => {
  const sidebar = document.createElement('div');
  sidebar.id = 'workspace-sidebar';
  const button = document.createElement('button');
  sidebar.append(button);
  document.body.append(sidebar);
  button.focus();
  mount('embedded');
  await waitFor(() =>
    expect(screen.getByTestId('rich-text')).toHaveAttribute('data-editable', 'true')
  );
  expect(button).toHaveFocus();
  expect(mocks.editor.focus).not.toHaveBeenCalled();
});
it.each([
  ['en', en, 'More actions', 'Copy page contents'],
  ['pt-BR', pt, 'Mais ações', 'Copiar conteúdo da nota'],
] as const)(
  'localizes embedded rich-text and actions in %s',
  async (language, dictionary, action, copy) => {
    await i18n.changeLanguage(language);
    mount('embedded');
    fireEvent.click(await screen.findByRole('button', { name: action }));
    expect(await screen.findByRole('menuitem', { name: copy })).toBeInTheDocument();
    expect(mocks.dictionary).toBe(dictionary);
  }
);

it.each(['tab', 'rename', 'device'] as const)(
  'never autofocuses embedded after delayed parse while %s has focus',
  async (control) => {
    let resolve!: (blocks: never[]) => void;
    mocks.editor.tryParseMarkdownToBlocks.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const field = document.createElement(
      control === 'tab' ? 'button' : control === 'rename' ? 'input' : 'select'
    );
    field.dataset.testid = 'external-focus';
    document.body.append(field);
    try {
      mount('embedded');
      await waitFor(() => expect(mocks.editor.tryParseMarkdownToBlocks).toHaveBeenCalledOnce());
      field.focus();
      expect(screen.getByTestId('rich-text')).toHaveAttribute('data-editable', 'false');
      await act(async () => resolve([]));
      await waitFor(() =>
        expect(screen.getByTestId('rich-text')).toHaveAttribute('data-editable', 'true')
      );
      expect(field).toHaveFocus();
      expect(mocks.editor.focus).not.toHaveBeenCalled();
    } finally {
      field.remove();
    }
  }
);
it.each(['en', 'pt-BR'])(
  'shows localized backend deletion refusal on the legacy editor in %s without navigation',
  async (language) => {
    await i18n.changeLanguage(language);
    mocks.delete.mockRejectedValueOnce(
      new Error('session_note_delete_requires_detach\nprivate diagnostic')
    );
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await waitFor(() =>
      expect(screen.getByTestId('rich-text')).toHaveAttribute('data-editable', 'true')
    );
    fireEvent.click(screen.getByRole('button', { name: i18n.t('noteMenu.open') }));
    fireEvent.click(await screen.findByRole('menuitem', { name: i18n.t('noteMenu.moveToTrash') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('editor.sessionNoteDeleteRequiresDetach')
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('private diagnostic');
    expect(confirm).toHaveBeenCalledWith(
      i18n.t('palette.deleteConfirm', { title: content.note.title })
    );
    if (language === 'pt-BR') expect(confirm.mock.calls[0][0]).toMatch(/^Excluir/);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.editor.tryParseMarkdownToBlocks).toHaveBeenCalledWith(content.markdown);
  }
);

it('focuses an embedded editor once only for an explicit board request', async () => {
  mount('embedded', editorFocusRequest());
  await waitFor(() => expect(mocks.editor.focus).toHaveBeenCalledOnce());
});
it.each(['focusin', 'pointerdown', 'keydown'] as const)(
  'cancels explicit board focus after later %s during parsing',
  async (event) => {
    let resolve!: (blocks: never[]) => void;
    mocks.editor.tryParseMarkdownToBlocks.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    mount('embedded', editorFocusRequest());
    await waitFor(() => expect(mocks.editor.tryParseMarkdownToBlocks).toHaveBeenCalledOnce());
    const field = document.createElement('input');
    document.body.append(field);
    try {
      if (event === 'focusin') field.focus();
      else field.dispatchEvent(new Event(event, { bubbles: true }));
      await act(async () => resolve([]));
      await waitFor(() =>
        expect(screen.getByTestId('rich-text')).toHaveAttribute('data-editable', 'true')
      );
      expect(mocks.editor.focus).not.toHaveBeenCalled();
    } finally {
      field.remove();
    }
  }
);

it('honors a fresh explicit open request for the already initialized board note', async () => {
  const client = new QueryClient();
  const view = (request: EditorFocusRequest) => (
    <QueryClientProvider client={client}>
      <NoteEditor
        noteId="embedded-note"
        content={content}
        variant="embedded"
        focusRequest={request}
      />
    </QueryClientProvider>
  );
  const rendered = render(view(editorFocusRequest()));
  await waitFor(() => expect(mocks.editor.focus).toHaveBeenCalledOnce());
  rendered.rerender(view(editorFocusRequest()));
  await waitFor(() => expect(mocks.editor.focus).toHaveBeenCalledTimes(2));
});
