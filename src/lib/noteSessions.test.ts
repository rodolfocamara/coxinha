import { QueryClient } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { noteSaveQueue, deleteAfterPendingSaves, waitForNotePersistence } from './noteSessions';
import { flushPendingSaves } from './lifecycle';

it('immediate deletion waits for the write, then removes its retained exit participant', async () => {
  let written!: () => void;
  const save = vi.fn(
    () =>
      new Promise<void>((r) => {
        written = r;
      })
  );
  const remove = vi.fn().mockResolvedValue(undefined);
  const queue = noteSaveQueue('delete-during-debounce', save);
  queue.change(Promise.resolve('pending edit'));
  const deletion = deleteAfterPendingSaves('delete-during-debounce', remove);
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(remove).not.toHaveBeenCalled();
  written();
  await deletion;
  queue.change(Promise.resolve('late editor unmount'));
  await queue.flush();
  await flushPendingSaves();
  expect(remove).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledTimes(1);
});
it('failed deletion retains edits made while delete IPC was in flight', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  let rejectDelete!: (error: Error) => void;
  const queue = noteSaveQueue('failed-delete', save);
  queue.change(Promise.resolve('first edit'));
  const deletion = deleteAfterPendingSaves(
    'failed-delete',
    () =>
      new Promise<void>((_, reject) => {
        rejectDelete = reject;
      })
  );
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  queue.change(Promise.resolve('edit during failed deletion'));
  rejectDelete(new Error('delete failed'));
  await expect(deletion).rejects.toThrow('delete failed');
  await queue.flush();
  expect(save.mock.calls).toEqual([['first edit'], ['edit during failed deletion']]);
  await deleteAfterPendingSaves('failed-delete', async () => {});
});
it('reopen waits for pending IPC before using an infinite-stale cached note', async () => {
  const client = new QueryClient();
  client.setQueryData(['note', 'reopen'], { markdown: 'old' });
  let written!: () => void;
  const queue = noteSaveQueue('reopen', async (markdown) => {
    await new Promise<void>((r) => {
      written = r;
    });
    client.setQueryData(['note', 'reopen'], { markdown });
  });
  queue.change(Promise.resolve('latest'));
  const firstMountFlush = queue.flush();
  let reopened = false;
  const secondMount = waitForNotePersistence('reopen').then(() => {
    reopened = true;
    return client.ensureQueryData({
      queryKey: ['note', 'reopen'],
      queryFn: async () => ({ markdown: 'unexpected' }),
      staleTime: Infinity,
    });
  });
  await vi.waitFor(() => expect(written).toBeTypeOf('function'));
  expect(reopened).toBe(false);
  written();
  await firstMountFlush;
  expect(await secondMount).toEqual({ markdown: 'latest' });
  await deleteAfterPendingSaves('reopen', async () => {});
});

it('a retained session uses the current editor save callback after remount', async () => {
  const oldSave = vi.fn().mockResolvedValue(undefined);
  const currentSave = vi.fn().mockRejectedValue('note_file_missing_or_moved');
  const queue = noteSaveQueue('remounted-writer', oldSave);
  expect(noteSaveQueue('remounted-writer', currentSave)).toBe(queue);
  queue.change(Promise.resolve('# retained'));
  await expect(queue.flush()).rejects.toBe('note_file_missing_or_moved');
  expect(oldSave).not.toHaveBeenCalled();
  expect(await queue.readRetainedSnapshot()).toEqual({ kind: 'markdown', markdown: '# retained' });
  currentSave.mockResolvedValue(undefined);
  await deleteAfterPendingSaves('remounted-writer', async () => {});
});
