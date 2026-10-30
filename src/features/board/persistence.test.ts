import { beforeEach, describe, it, expect, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
describe('durable board session', () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
  });
  it('serializes concurrent edits and advances the revision without dropping edits made during IPC', async () => {
    const { emptyBoard } = await import('./model');
    const initial = emptyBoard();
    invoke.mockResolvedValueOnce(initial);
    const { boardSession: s } = await import('./persistence');
    await s.load();
    s.update({ ...initial, revision: 0 });
    let finish!: (b: unknown) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const saving = s.flush();
    s.update({ ...initial, items: [], version: 1 });
    invoke.mockResolvedValueOnce({ ...initial, revision: 2 });
    finish({ ...initial, revision: 1 });
    await saving;
    expect(invoke.mock.calls[2][1].board.revision).toBe(1);
    expect(s.get()?.revision).toBe(2);
    expect(s.dirty()).toBe(false);
  });
  it('retains unsaved geometry on failure and propagates failure to the exit barrier, then retries', async () => {
    const { emptyBoard } = await import('./model');
    const initial = emptyBoard();
    invoke.mockResolvedValueOnce(initial);
    const { boardSession: s } = await import('./persistence');
    const { flushPendingSaves } = await import('../../lib/lifecycle');
    await s.load();
    s.update(initial);
    invoke.mockRejectedValueOnce('disk full');
    await expect(flushPendingSaves()).rejects.toMatchObject({ category: 'save_failed' });
    expect(s.dirty()).toBe(true);
    expect(s.error()).toContain('disk full');
    invoke.mockResolvedValueOnce({ ...initial, revision: 1 });
    await flushPendingSaves();
    expect(s.dirty()).toBe(false);
  });
});
it('coalesces competing initial loads and preserves failed-save changes until explicit reload', async () => {
  vi.resetModules();
  invoke.mockReset();
  const { emptyBoard } = await import('./model');
  const initial = emptyBoard();
  let resolve!: (b: unknown) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const { boardSession: s } = await import('./persistence');
  const first = s.load();
  const second = s.load();
  expect(invoke).toHaveBeenCalledTimes(1);
  resolve(initial);
  await Promise.all([first, second]);
  s.update({ ...initial, revision: 1 });
  invoke.mockRejectedValueOnce('board revision conflict: reload required');
  await expect(s.flush()).rejects.toContain('conflict');
  expect(s.get()?.revision).toBe(1);
  expect(s.dirty()).toBe(true);
  invoke.mockResolvedValueOnce({ ...initial, revision: 5 });
  await s.reloadSaved();
  expect(s.get()?.revision).toBe(5);
  expect(s.dirty()).toBe(false);
  expect(s.error()).toBe(null);
});
it('exports dirty data through the native vault command without clearing pending changes', async () => {
  vi.resetModules();
  invoke.mockReset();
  const { boardSession: s, errorCategory } = await import('./persistence');
  const board = { version: 1, revision: 3, items: [], edges: [] };
  invoke.mockResolvedValueOnce(board);
  await s.load();
  s.update(board);
  invoke.mockResolvedValueOnce('/fixture/.coxinha/recovery/board-uuid.json');
  await s.exportRecovery();
  expect(invoke.mock.calls[1]).toEqual([
    'board_export_recovery',
    { board: { ...board, version: 3 } },
  ]);
  expect(s.dirty()).toBe(true);
  expect(errorCategory('board revision conflict: reload required')).toBe('conflictError');
  expect(errorCategory('invalid board item')).toBe('validationError');
  expect(errorCategory('cannot sync board')).toBe('saveError');
});
