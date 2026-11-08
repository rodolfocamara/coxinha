import { describe, expect, it, vi } from 'vitest';
import { flushPendingSaves, registerSaveParticipant } from './lifecycle';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
describe('desktop durable flush', () => {
  it('waits for the actual save acknowledgement', async () => {
    let acknowledge!: () => void;
    const unregister = registerSaveParticipant(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        })
    );
    let finished = false;
    const flush = flushPendingSaves().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    acknowledge();
    await flush;
    expect(finished).toBe(true);
    unregister();
  });
  it('keeps failed saves registered for an explicit retry', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValue(undefined);
    const unregister = registerSaveParticipant(save);
    await expect(flushPendingSaves()).rejects.toThrow('save_failed');
    await flushPendingSaves();
    expect(save).toHaveBeenCalledTimes(2);
    unregister();
  });
  it('removing a participant does not cancel an in-flight save', async () => {
    let acknowledge!: () => void;
    const unregister = registerSaveParticipant(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        })
    );
    const flush = flushPendingSaves();
    unregister();
    await Promise.resolve();
    acknowledge();
    await flush;
    await flushPendingSaves();
  });
});

it('refuses successful exit while attachment insertion is pending and unlocks safely', async () => {
  const { beginEditorUpload, setExitLocked, discardEditorUploads } = await import('./lifecycle');
  const finish = beginEditorUpload('upload-fixture');
  setExitLocked(true);
  await expect(flushPendingSaves()).rejects.toThrow('attachment_pending');
  expect(() => beginEditorUpload('upload-fixture')).toThrow('desktop exit');
  finish();
  await flushPendingSaves();
  setExitLocked(false);
  const discarded = beginEditorUpload('deleted-upload');
  discardEditorUploads('deleted-upload');
  await flushPendingSaves();
  discarded();
});

it('drains all independent note writes before reporting a pending attachment', async () => {
  const { beginEditorUpload } = await import('./lifecycle');
  const finish = beginEditorUpload('pending-after-drain');
  const save = vi.fn().mockResolvedValue(undefined);
  const unregister = registerSaveParticipant(save);
  await expect(flushPendingSaves()).rejects.toMatchObject({ category: 'attachment_pending' });
  expect(save).toHaveBeenCalledOnce();
  finish();
  unregister();
});
