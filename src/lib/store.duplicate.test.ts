import { expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from './store';
import { noteSaveQueue, deleteAfterPendingSaves } from './noteSessions';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
it('duplicates acknowledged edits and never reads or creates the copy while a source write is pending', async () => {
  const id = 'duplicate-pending-fixture';
  const source = { id, title: 'source', updated_at: '', created_at: '', tags: [] };
  let markdown = '# old';
  let acknowledge!: () => void;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const data = args as { id?: string; content?: string };
    if (command === 'update_note' && data.id === id) {
      await new Promise<void>((resolve) => {
        acknowledge = resolve;
      });
      markdown = data.content!;
      return source;
    }
    if (command === 'get_note') return { note: source, markdown };
    if (command === 'create_note') return { ...source, id: 'copy' };
    if (command === 'update_note') return { ...source, id: 'copy' };
    throw new Error('unexpected command');
  });
  const queue = noteSaveQueue(id, (content) => useAppStore.getState().saveNote(id, content));
  queue.change(Promise.resolve('# latest\nnew body'));
  const duplicate = useAppStore.getState().duplicateNote(id);
  await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'));
  expect(vi.mocked(invoke).mock.calls.map((call) => call[0])).toEqual(['update_note']);
  acknowledge();
  expect((await duplicate).id).toBe('copy');
  expect(invoke).toHaveBeenCalledWith('update_note', {
    id: 'copy',
    content: '# latest (copy)\nnew body',
  });
  await deleteAfterPendingSaves(id, async () => {});
});
