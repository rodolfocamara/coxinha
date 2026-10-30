import { expect, it, vi } from 'vitest';
import { SaveQueue } from './saveQueue';
it('retains serialized edits for retry after the editor is gone', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
  const queue = new SaveQueue(save);
  queue.change(Promise.resolve('note A'));
  await expect(queue.flush()).rejects.toThrow('disk full');
  await queue.flush();
  expect(save.mock.calls).toEqual([['note A'], ['note A']]);
});
it('serializes writes and drains edits made during an in-flight write', async () => {
  let acknowledge!: () => void;
  const save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          acknowledge = r;
        })
    )
    .mockResolvedValue(undefined);
  const queue = new SaveQueue(save);
  queue.change(Promise.resolve('first'));
  const pending = queue.flush();
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  queue.change(Promise.resolve('latest'));
  acknowledge();
  await pending;
  expect(save.mock.calls).toEqual([['first'], ['latest']]);
});
it('does not confuse snapshots when switching between note instances', async () => {
  let convert!: (markdown: string) => void;
  const saveA = vi.fn().mockResolvedValue(undefined);
  const saveB = vi.fn().mockResolvedValue(undefined);
  const noteA = new SaveQueue(saveA);
  const noteB = new SaveQueue(saveB);
  noteA.change(
    new Promise<string>((r) => {
      convert = r;
    })
  );
  const savingA = noteA.flush();
  noteB.change(Promise.resolve('B'));
  await noteB.flush();
  convert('A');
  await savingA;
  expect(saveA).toHaveBeenCalledWith('A');
  expect(saveB).toHaveBeenCalledWith('B');
});
