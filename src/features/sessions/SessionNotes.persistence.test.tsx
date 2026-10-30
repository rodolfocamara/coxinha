import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import '../../lib/i18n';
import { noteSaveQueue, deleteAfterPendingSaves } from '../../lib/noteSessions';
import { persistNote } from '../../lib/notePersistence';
import { useAppStore } from '../../lib/store';
import { SessionNotes } from './SessionNotes';
const richText = vi.hoisted(() => ({
  document: [],
  tryParseMarkdownToBlocks: vi.fn(async () => []),
  replaceBlocks: vi.fn(),
  blocksToMarkdownLossy: vi.fn(() => ''),
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
  BlockNoteView: () => <div data-testid="real-editor-boundary" />,
}));
vi.mock('../meetings/MeetingBlock', () => ({ meetingBlockSpec: {} }));
vi.mock('../notes/BacklinksPanel', () => ({ BacklinksPanel: () => null }));
vi.mock('../notes/NoteHeader', () => ({ NoteHeader: () => null }));
vi.mock('../../lib/useTheme', () => ({ useResolvedTheme: () => 'light' }));
afterEach(async () => {
  cleanup();
  await deleteAfterPendingSaves('session-retained', async () => {});
});
it('reopens the real session editor with retained failed text and retries through the existing save queue', async () => {
  const id = 'session-retained';
  const note = {
    id,
    title: 'Private note',
    path: 'notes/owned.md',
    tags: [],
    created_at: '',
    updated_at: '',
  };
  let body = 'Older durable body';
  let fail = true;
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'library_ensure_personal_note') return { personal_note: { id } };
    if (command === 'get_note') return { note, markdown: body };
    if (command === 'update_note') {
      if (fail) throw 'disk full';
      body = (args as { content: string }).content;
      return note;
    }
    throw new Error(`Unexpected ${command}`);
  });
  useAppStore.setState({ notes: [note] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queue = noteSaveQueue(id, (text) => persistNote(client, id, text));
  const retained = '# Exact private notes\nKeep after tab/reopen.';
  queue.change(Promise.resolve(retained));
  await expect(queue.flush()).rejects.toBe('disk full');
  function mount() {
    return render(
      <QueryClientProvider client={client}>
        <SessionNotes sessionId="owner" />
      </QueryClientProvider>
    );
  }
  const first = mount();
  expect(await screen.findByRole('textbox')).toHaveValue(retained);
  first.unmount();
  mount();
  expect(await screen.findByRole('textbox')).toHaveValue(retained);
  expect(body).toBe('Older durable body');
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
  await waitFor(() => expect(screen.getByTestId('real-editor-boundary')).toBeInTheDocument());
  expect(body).toBe(retained);
  await waitFor(() => expect(richText.tryParseMarkdownToBlocks).toHaveBeenCalledWith(retained));
  expect(invoke).not.toHaveBeenCalledWith('create_note', expect.anything());
});
