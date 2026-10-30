import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import '../../lib/i18n';
import './locale';
import { deleteAfterPendingSaves, waitForNotePersistence } from '../../lib/noteSessions';
import { useAppStore } from '../../lib/store';
import { editorFocusRequest } from '../notes/editorFocusRequest';
import { BoardNotePanel } from './BoardNotePanel';
const richText = vi.hoisted(() => ({
  markdown: '',
  document: [],
  tryParseMarkdownToBlocks: vi.fn(async (text: string) => text),
  replaceBlocks: vi.fn((_document: unknown, text: string) => {
    richText.markdown = text;
  }),
  blocksToMarkdownLossy: vi.fn(() => richText.markdown),
  getBlock: vi.fn(),
  focus: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/settings">{children}</a>,
}));
vi.mock('@blocknote/core', () => ({ BlockNoteSchema: { create: vi.fn() }, defaultBlockSpecs: {} }));
vi.mock('@blocknote/react', () => ({ useCreateBlockNote: () => richText }));
vi.mock('@blocknote/shadcn', () => ({
  BlockNoteView: ({ onChange, editable }: { onChange: () => void; editable: boolean }) => (
    <textarea
      aria-label="BlockNote boundary"
      disabled={!editable}
      onChange={(event) => {
        richText.markdown = event.target.value;
        onChange();
      }}
    />
  ),
}));
vi.mock('../meetings/MeetingBlock', () => ({ meetingBlockSpec: {} }));
vi.mock('../notes/BacklinksPanel', () => ({ BacklinksPanel: () => null }));
vi.mock('../../lib/useTheme', () => ({ useResolvedTheme: () => 'light' }));
const note = (id: string) => ({
  id,
  title: id,
  path: `notes/${id}.md`,
  tags: [],
  created_at: '',
  updated_at: '',
});
let bodies: Record<string, string>;
let writer: (id: string, text: string) => Promise<void>;
beforeEach(() => {
  bodies = { 'board-a': '# Old A', 'board-b': '# B' };
  writer = async (id, text) => {
    bodies[id] = text;
  };
  richText.focus.mockClear();
  richText.tryParseMarkdownToBlocks.mockClear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const a = args as { id: string; content: string };
    if (command === 'get_note') return { note: note(a.id), markdown: bodies[a.id] };
    if (command === 'update_note') {
      await writer(a.id, a.content);
      return { ...note(a.id), title: a.content.split('\n')[0].replace(/^# /, '') };
    }
    throw new Error(`Unexpected ${command}`);
  });
  useAppStore.setState({ notes: [note('board-a'), note('board-b')] });
});
afterEach(async () => {
  cleanup();
  writer = async () => {};
  await deleteAfterPendingSaves('board-a', async () => {});
  await deleteAfterPendingSaves('board-b', async () => {});
});
function host() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const request = editorFocusRequest();
  const close = vi.fn();
  const panel = (id: string) => (
    <QueryClientProvider client={client}>
      <BoardNotePanel key={id} noteId={id} focusRequest={request} close={close} />
    </QueryClientProvider>
  );
  return { panel, close, client };
}
async function edit(text: string) {
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'BlockNote boundary' })).toBeEnabled()
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'BlockNote boundary' }), {
    target: { value: text },
  });
}
it('persists title and checklist through the canonical queue and reopens the same note', async () => {
  const { panel } = host();
  const first = render(panel('board-a'));
  const text = '# Plan launch\n\n- [ ] Draft\n- [x] Review';
  await edit(text);
  await act(async () => waitForNotePersistence('board-a'));
  expect(bodies['board-a']).toBe(text);
  expect(useAppStore.getState().notes.find((n) => n.id === 'board-a')?.title).toBe('Plan launch');
  first.unmount();
  render(panel('board-a'));
  await waitFor(() => expect(richText.tryParseMarkdownToBlocks).toHaveBeenLastCalledWith(text));
  expect(invoke).not.toHaveBeenCalledWith('create_note', expect.anything());
});
it('keeps closing/switching drafts during an in-flight failure, reports error, and recovers on reopen', async () => {
  let reject!: (error: Error) => void;
  let fail = true;
  const saveError = vi.fn();
  window.addEventListener('coxinha-save-error', saveError);
  const { panel } = host();
  const first = render(panel('board-a'));
  const text = '# Unacknowledged title\n- [ ] Keep this draft';
  await edit(text);
  let firstWrite = true;
  writer = async (id, value) => {
    if (id === 'board-a' && fail) {
      if (!firstWrite) throw new Error('disk full');
      firstWrite = false;
      await new Promise<void>((_resolve, rejectSave) => {
        reject = rejectSave;
      });
    }
    bodies[id] = value;
  };
  const pending = waitForNotePersistence('board-a').catch(() => {});
  await waitFor(() => expect(reject).toBeTypeOf('function'));
  first.rerender(panel('board-b'));
  await waitFor(() => expect(richText.tryParseMarkdownToBlocks).toHaveBeenLastCalledWith('# B'));
  first.unmount();
  await act(async () => {
    reject(new Error('disk full'));
    await pending;
  });
  await waitFor(() => expect(saveError).toHaveBeenCalled());
  expect(bodies['board-a']).toBe('# Old A');
  // Further retries fail immediately, retaining the exact snapshot.
  writer = async () => {
    throw new Error('disk full');
  };
  render(panel('board-a'));
  expect(await screen.findByRole('textbox', { name: 'Unsaved Markdown' })).toHaveValue(text);
  expect(screen.getByRole('alert')).toBeVisible();
  fail = false;
  writer = async (id, value) => {
    bodies[id] = value;
  };
  fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
  await waitFor(() => expect(richText.tryParseMarkdownToBlocks).toHaveBeenLastCalledWith(text));
  expect(bodies['board-a']).toBe(text);
  window.removeEventListener('coxinha-save-error', saveError);
});

it('closes the editor with Escape while allowing a nested actions menu to consume it first', async () => {
  const { panel, close } = host();
  render(panel('board-a'));
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'BlockNote boundary' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  const menu = await screen.findByRole('menu', { name: 'Note actions' });
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'BlockNote boundary' }), { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});

it('reads on initial open and reopen but avoids stale window-focus IPC refetches', async () => {
  const { panel, client } = host();
  const first = render(panel('board-a'));
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'BlockNote boundary' })).toBeEnabled()
  );
  const reads = () =>
    vi.mocked(invoke).mock.calls.filter(([command]) => command === 'get_note').length;
  expect(reads()).toBe(1);
  await act(async () => client.getQueryCache().onFocus());
  expect(reads()).toBe(1);
  first.unmount();
  render(panel('board-a'));
  await waitFor(() => expect(reads()).toBe(2));
});
