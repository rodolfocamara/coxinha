vi.mock('../board/locale', () => ({}));
import type { ReactNode } from 'react';
import { act, cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NoteEditor } from './NoteEditor';
import { flushPendingSaves, setExitLocked } from '../../lib/lifecycle';
import { deleteAfterPendingSaves, noteSaveQueue } from '../../lib/noteSessions';
const mocks = vi.hoisted(() => ({
  client: { getQueryData: vi.fn() },
  duplicate: vi.fn(),
  invoke: vi.fn(),
  upload: undefined as undefined | ((file: File, blockId?: string) => Promise<string>),
  delete: vi.fn(),
  save: vi.fn().mockResolvedValue(undefined),
  change: undefined as undefined | (() => void),
  editor: {
    document: [],
    getBlock: vi.fn(),
    focus: vi.fn(),
    replaceBlocks: vi.fn(),
    tryParseMarkdownToBlocks: vi.fn(),
    blocksToMarkdownLossy: vi.fn(() => 'edited'),
  },
}));
vi.mock('@blocknote/react', () => ({
  useCreateBlockNote: (options: { uploadFile: typeof mocks.upload }) => {
    mocks.upload = options.uploadFile;
    return mocks.editor;
  },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => mocks.invoke(...args) }));
vi.mock('@blocknote/core', () => ({ BlockNoteSchema: { create: vi.fn() }, defaultBlockSpecs: {} }));
vi.mock('@blocknote/shadcn', () => ({
  BlockNoteView: ({ onChange, editable }: { onChange: () => void; editable: boolean }) => {
    mocks.change = onChange;
    return <div data-testid="editable" data-editable={String(editable)} />;
  },
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => mocks.client }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to, hash }: { children: ReactNode; to: string; hash?: string }) => (
    <a href={`${to}${hash ? `#${hash}` : ''}`}>{children}</a>
  ),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../lib/store', () => ({
  useAppStore: (select: (value: unknown) => unknown) =>
    select({ deleteNote: mocks.delete, duplicateNote: mocks.duplicate }),
}));
vi.mock('../../lib/notePersistence', () => ({
  persistNote: (...args: unknown[]) => mocks.save(...args),
}));
vi.mock('../../lib/perf', () => ({ mark: vi.fn(), logNewNoteTrace: vi.fn() }));
vi.mock('../../lib/useTheme', () => ({ useResolvedTheme: () => 'light' }));
vi.mock('../meetings/MeetingBlock', () => ({ meetingBlockSpec: {} }));
vi.mock('./BacklinksPanel', () => ({ BacklinksPanel: () => null }));
vi.mock('./NoteActionsMenu', () => ({
  NoteActionsMenu: ({
    onDuplicate,
    onMoveToTrash,
  }: {
    onDuplicate: () => void;
    onMoveToTrash: () => void;
  }) => (
    <>
      <button onClick={onDuplicate}>duplicate-fixture</button>
      <button onClick={onMoveToTrash}>delete-fixture</button>
    </>
  ),
}));
vi.mock('./NoteHeader', () => ({
  NoteHeader: ({ title, tags }: { title: string; tags: string[] }) => (
    <div data-testid="metadata">
      {title} {tags.join(',')}
    </div>
  ),
}));
const content = {
  markdown: '# initial',
  note: { title: 'fixture', tags: [], updated_at: '' },
} as never;
afterEach(async () => {
  cleanup();
  setExitLocked(false);
  await deleteAfterPendingSaves('editor-load', async () => {});
  await deleteAfterPendingSaves('editor-next', async () => {});
  mocks.client.getQueryData.mockReset();
  mocks.duplicate.mockReset();
  mocks.delete.mockReset();
  mocks.invoke.mockReset();
  mocks.editor.getBlock.mockReset();
  mocks.save.mockClear();
  mocks.editor.replaceBlocks.mockReset();
  mocks.editor.tryParseMarkdownToBlocks.mockReset();
});
it('does not save initialization changes and makes editor readonly during exit', async () => {
  mocks.editor.tryParseMarkdownToBlocks.mockResolvedValue(['loaded']);
  mocks.editor.replaceBlocks.mockImplementation(() => mocks.change?.());
  await act(async () => {
    render(<NoteEditor noteId="editor-load" content={content} />);
  });
  expect(screen.getByTestId('editable')).toHaveAttribute('data-editable', 'true');
  await flushPendingSaves();
  expect(mocks.save).not.toHaveBeenCalled();
  await act(async () => {
    setExitLocked(true);
  });
  expect(screen.getByTestId('editable')).toHaveAttribute('data-editable', 'false');
  mocks.editor.blocksToMarkdownLossy.mockReturnValue('genuine user edit');
  await act(async () => {
    setExitLocked(false);
    mocks.change?.();
  });
  await flushPendingSaves();
  expect(mocks.save).toHaveBeenCalledOnce();
});
it('an older async parse cannot replace the newly opened note', async () => {
  let oldParse!: (blocks: string[]) => void;
  mocks.editor.tryParseMarkdownToBlocks
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          oldParse = r;
        })
    )
    .mockResolvedValueOnce(['latest']);
  const view = render(<NoteEditor noteId="editor-load" content={content} />);
  await waitFor(() => expect(oldParse).toBeTypeOf('function'));
  await act(async () => {
    view.rerender(<NoteEditor noteId="editor-next" content={content} />);
  });
  await act(async () => {
    oldParse(['obsolete']);
  });
  expect(mocks.editor.replaceBlocks).toHaveBeenCalledTimes(1);
  expect(mocks.editor.replaceBlocks).toHaveBeenCalledWith([], ['latest']);
  await flushPendingSaves();
  expect(mocks.save).not.toHaveBeenCalled();
});

it('a cached editor mount waits for pending IPC and parses only the acknowledged content', async () => {
  let acknowledge!: () => void;
  const queue = noteSaveQueue('editor-load', async () => {
    await new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    mocks.client.getQueryData.mockReturnValue({
      note: { title: 'fixture', tags: [], updated_at: '' },
      markdown: '# acknowledged',
    });
  });
  queue.change(Promise.resolve('# latest'));
  const write = queue.flush();
  await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'));
  mocks.editor.tryParseMarkdownToBlocks.mockResolvedValue(['acknowledged']);
  const view = render(<NoteEditor noteId="editor-load" content={content} />);
  expect(screen.queryByTestId('editable')).toBeNull();
  await act(async () => {
    acknowledge();
    await write;
  });
  expect(mocks.editor.tryParseMarkdownToBlocks).toHaveBeenLastCalledWith('# acknowledged');
  expect(screen.getByTestId('editable')).toHaveAttribute('data-editable', 'true');
  view.unmount();
});

it('reports duplication failure locally without claiming the source save failed', async () => {
  mocks.editor.tryParseMarkdownToBlocks.mockResolvedValue(['loaded']);
  mocks.duplicate.mockRejectedValue(new Error('copy unavailable'));
  const saveError = vi.fn();
  window.addEventListener('coxinha-save-error', saveError);
  await act(async () => {
    render(<NoteEditor noteId="editor-load" content={content} />);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'duplicate-fixture' }));
  });
  expect(screen.getByRole('alert')).toHaveTextContent('editor.duplicateFailed');
  expect(saveError).not.toHaveBeenCalled();
  window.removeEventListener('coxinha-save-error', saveError);
});

it('recovers retained Markdown after failed write and remount, then retries without opening stale text', async () => {
  let failing = true;
  const queue = noteSaveQueue('editor-load', async (markdown) => {
    if (failing) throw new Error('disk full');
    mocks.client.getQueryData.mockReturnValue({
      note: { title: 'recovered', tags: [], updated_at: '' },
      markdown,
    });
  });
  queue.change(Promise.resolve('# retained unsaved Markdown'));
  await expect(queue.flush()).rejects.toThrow('disk full');
  const first = render(<NoteEditor noteId="editor-load" content={content} />);
  await screen.findByRole('textbox', { name: 'noteRecovery.markdown' });
  first.unmount();
  render(<NoteEditor noteId="editor-load" content={content} />);
  const recovered = await screen.findByRole('textbox', { name: 'noteRecovery.markdown' });
  expect(recovered).toHaveValue('# retained unsaved Markdown');
  expect(screen.queryByTestId('editable')).toBeNull();
  failing = false;
  mocks.editor.tryParseMarkdownToBlocks.mockResolvedValue(['recovered']);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'noteRecovery.retry' }));
  });
  expect(mocks.editor.tryParseMarkdownToBlocks).toHaveBeenLastCalledWith(
    '# retained unsaved Markdown'
  );
  expect(screen.getByTestId('editable')).toHaveAttribute('data-editable', 'true');
});
it('refreshes acknowledged metadata without reparsing the editor document', async () => {
  mocks.editor.tryParseMarkdownToBlocks.mockResolvedValue(['initial']);
  const firstContent = {
    markdown: '# initial',
    note: { title: 'old title', tags: [], updated_at: '' },
  } as never;
  const nextContent = {
    markdown: '# latest',
    note: { title: 'new title', tags: ['tag'], updated_at: '' },
  } as never;
  const view = render(<NoteEditor noteId="editor-load" content={firstContent} />);
  // Snapshot the parse count only after the initial load finished parsing.
  await waitFor(() =>
    expect(screen.getByTestId('editable')).toHaveAttribute('data-editable', 'true')
  );
  await waitFor(() => expect(mocks.editor.tryParseMarkdownToBlocks).toHaveBeenCalled());
  const parsed = mocks.editor.tryParseMarkdownToBlocks.mock.calls.length;
  view.rerender(<NoteEditor noteId="editor-load" content={nextContent} />);
  expect(screen.getByTestId('metadata')).toHaveTextContent('new title tag');
  expect(mocks.editor.tryParseMarkdownToBlocks).toHaveBeenCalledTimes(parsed);
});

it('reports failed deletion locally and retains the source editor', async () => {
  mocks.editor.tryParseMarkdownToBlocks.mockResolvedValue(['loaded']);
  mocks.delete.mockRejectedValue(new Error('delete unavailable'));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  await act(async () => {
    render(<NoteEditor noteId="editor-load" content={content} />);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'delete-fixture' }));
  });
  expect(screen.getByRole('alert')).toHaveTextContent('editor.deleteFailed');
  expect(screen.getByTestId('editable')).toBeInTheDocument();
  confirm.mockRestore();
});
it('releases a pending upload only when its previously observed owner block is removed', async () => {
  mocks.editor.tryParseMarkdownToBlocks.mockResolvedValue(['loaded']);
  mocks.editor.getBlock.mockReturnValue({ id: 'upload-block' });
  let acknowledge!: (path: string) => void;
  mocks.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      })
  );
  await act(async () => {
    render(<NoteEditor noteId="editor-load" content={content} />);
  });
  const file = {
    type: 'text/plain',
    name: 'fixture.txt',
    arrayBuffer: async () => new ArrayBuffer(0),
  } as File;
  const upload = mocks.upload!(file, 'upload-block');
  await waitFor(() => expect(acknowledge).toBeTypeOf('function'));
  await expect(flushPendingSaves()).rejects.toMatchObject({ category: 'attachment_pending' });
  mocks.editor.getBlock.mockReturnValue(undefined);
  await act(async () => {
    mocks.change?.();
  });
  await flushPendingSaves();
  acknowledge('attachments/fixture.txt');
  await upload;
  await flushPendingSaves();
});

it('surfaces a missing-file save in the active remounted editor and retains text across recovery retry', async () => {
  // A slow parse keeps the editor initializing after it renders; edits made then are ignored.
  mocks.editor.tryParseMarkdownToBlocks.mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(['loaded']), 20))
  );
  const first = render(<NoteEditor noteId="editor-load" content={content} />);
  await screen.findByTestId('editable');
  first.unmount();
  // The queue survives the first editor. A later failure must reach this mount.
  render(<NoteEditor noteId="editor-load" content={content} />);
  await waitFor(() =>
    expect(screen.getByTestId('editable')).toHaveAttribute('data-editable', 'true')
  );
  mocks.editor.blocksToMarkdownLossy.mockReturnValue('# retained after external move');
  mocks.save.mockRejectedValue('note_file_missing_or_moved');
  try {
    await act(async () => {
      mocks.change?.();
    });
    await act(async () => {
      await expect(flushPendingSaves()).rejects.toBeDefined();
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('noteRecovery.missingOrMoved');
    expect(screen.getByRole('textbox', { name: 'noteRecovery.markdown' })).toHaveValue(
      '# retained after external move'
    );
    expect(screen.queryByTestId('editable')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'noteRecovery.retry' }));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('noteRecovery.missingOrMoved');
    expect(screen.getByRole('textbox')).toHaveValue('# retained after external move');
    mocks.save.mockResolvedValue(undefined);
    mocks.client.getQueryData.mockReturnValue({
      note: { title: 'recovered', tags: [], updated_at: '' },
      markdown: '# retained after external move',
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'noteRecovery.retry' }));
    });
    expect(await screen.findByTestId('editable')).toBeInTheDocument();
    expect(mocks.editor.tryParseMarkdownToBlocks).toHaveBeenLastCalledWith(
      '# retained after external move'
    );
  } finally {
    mocks.save.mockResolvedValue(undefined);
  }
});

it.each([
  ['note_file_changed_externally', 'noteRecovery.changedExternally'],
  ['note_file_identity_conflict', 'noteRecovery.identityConflict'],
  ['note_file_invalid_metadata', 'noteRecovery.invalidMetadata'],
])('retains pending text across remount and manual retry for %s', async (code, message) => {
  mocks.editor.blocksToMarkdownLossy.mockReturnValue('# Initial fixture');
  mocks.editor.tryParseMarkdownToBlocks.mockResolvedValue(['loaded']);
  const view = render(<NoteEditor noteId="editor-load" content={content} />);
  await waitFor(() =>
    expect(screen.getByTestId('editable')).toHaveAttribute('data-editable', 'true')
  );
  const parsed = mocks.editor.tryParseMarkdownToBlocks.mock.calls.length;
  mocks.editor.blocksToMarkdownLossy.mockReturnValue('# Pending conflict text');
  mocks.save.mockRejectedValue(new Error(code));
  try {
    await act(async () => {
      mocks.change?.();
    });
    await act(async () => {
      await expect(flushPendingSaves()).rejects.toBeDefined();
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    view.unmount();
    render(<NoteEditor noteId="editor-load" content={content} />);
    expect(await screen.findByRole('textbox')).toHaveValue('# Pending conflict text');
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(mocks.editor.tryParseMarkdownToBlocks).toHaveBeenCalledTimes(parsed);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'noteRecovery.retryAfterReconcile' }));
    });
    expect(await screen.findByRole('textbox')).toHaveValue('# Pending conflict text');
    expect(screen.queryByTestId('editable')).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
    // Model an explicit file reconciliation before retry is acknowledged.
    mocks.save.mockResolvedValue(undefined);
    mocks.client.getQueryData.mockReturnValue({
      note: { title: 'reconciled', tags: [], updated_at: '' },
      markdown: '# Pending conflict text',
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'noteRecovery.retryAfterReconcile' }));
    });
    expect(await screen.findByTestId('editable')).toBeInTheDocument();
    expect(mocks.editor.tryParseMarkdownToBlocks).toHaveBeenLastCalledWith(
      '# Pending conflict text'
    );
  } finally {
    mocks.save.mockResolvedValue(undefined);
  }
});

it.each([
  ['note_file_missing_or_moved', 'noteRecovery.missingOrMoved'],
  ['note_file_changed_externally', 'noteRecovery.changedExternally'],
  ['note_file_identity_conflict', 'noteRecovery.identityConflict'],
  ['note_file_invalid_metadata', 'noteRecovery.invalidMetadata'],
])('keeps the source editor and gives stable delete guidance for %s', async (code, message) => {
  mocks.editor.blocksToMarkdownLossy.mockReturnValue('# Unchanged editor');
  mocks.editor.tryParseMarkdownToBlocks.mockResolvedValue(['loaded']);
  mocks.delete.mockRejectedValue(new Error(code));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  try {
    render(<NoteEditor noteId="editor-load" content={content} />);
    await waitFor(() =>
      expect(screen.getByTestId('editable')).toHaveAttribute('data-editable', 'true')
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'delete-fixture' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByTestId('editable')).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  } finally {
    confirm.mockRestore();
  }
});
