import { invoke } from '@tauri-apps/api/core';
import { registerSaveParticipant } from '../../lib/lifecycle';
import type { Board } from './model';
/** A vault session survives route unmounts so closing from an editor still flushes its board. */
let current: Board | null = null;
let dirty = false;
let running: Promise<void> | null = null;
let generation = 0;
let loading: Promise<Board> | null = null;
let listeners = new Set<() => void>();
let error: string | null = null;
function notify() {
  listeners.forEach((f) => f());
}
export function errorCategory(error: string) {
  if (error.includes('conflict')) return 'conflictError';
  if (error.includes('invalid') || error.includes('unsupported') || error.includes('unknown note'))
    return 'validationError';
  return 'saveError';
}
export const boardSession = {
  async exportRecovery() {
    if (current) await invoke<string>('board_export_recovery', { board: current });
  },
  subscribe(f: () => void) {
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  },
  get: () => current,
  error: () => error,
  dirty: () => dirty,
  async load() {
    if (current) return current;
    if (!loading)
      loading = invoke<Board>('board_load')
        .then((board) => {
          current = board;
          notify();
          return board;
        })
        .finally(() => {
          loading = null;
        });
    return loading;
  },
  async reloadSaved() {
    if (running) await running.catch(() => {});
    const beforeReload = generation;
    const loaded = await invoke<Board>('board_load');
    if (generation !== beforeReload)
      throw new Error('Board changed while reloading; retry explicitly.');
    current = loaded;
    dirty = false;
    error = null;
    generation++;
    notify();
  },
  update(board: Board) {
    current = { ...board, version: 3 };
    dirty = true;
    generation++;
    error = null;
    notify();
  },
  async flush(): Promise<void> {
    if (running) {
      await running;
      if (dirty) return boardSession.flush();
      return;
    }
    if (!dirty || !current) return;
    running = (async () => {
      while (dirty && current) {
        const sent: Board = current;
        const version = generation;
        try {
          const saved: Board = await invoke<Board>('board_save', { board: sent });
          current = { ...current, revision: saved.revision };
          dirty = generation !== version;
          error = null;
          notify();
        } catch (e) {
          error = String(e);
          notify();
          throw e;
        }
      }
    })();
    try {
      await running;
    } finally {
      running = null;
    }
  },
};
registerSaveParticipant(() => boardSession.flush());
