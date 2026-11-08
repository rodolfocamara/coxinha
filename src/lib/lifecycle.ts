import { invoke } from '@tauri-apps/api/core';
/** Save participants resolve only after durable IPC acknowledgement. */
const savers = new Set<() => Promise<void>>();
export function registerSaveParticipant(save: () => Promise<void>) {
  savers.add(save);
  return () => {
    savers.delete(save);
  };
}
export class FlushFailure extends Error {
  constructor(public readonly category: 'save_failed' | 'attachment_pending') {
    super(category);
  }
}
export async function flushPendingSaves() {
  const results = await Promise.allSettled([...savers].map((save) => Promise.resolve().then(save)));
  if (results.some((result) => result.status === 'rejected')) throw new FlushFailure('save_failed');
  if (pendingUploads.size) throw new FlushFailure('attachment_pending');
}

export function reportFrontendError(
  category:
    | 'frontend_error'
    | 'frontend_rejection'
    | 'save_failed'
    | 'root_render_error'
    | 'attachment_pending'
) {
  void invoke('desktop_diagnostic', { category }).catch(() => {});
}

let exitLocked = false;
const exitListeners = new Set<() => void>();
export function isExitLocked() {
  return exitLocked;
}
export function setExitLocked(locked: boolean) {
  exitLocked = locked;
  exitListeners.forEach((listener) => listener());
}
export function subscribeExitLock(listener: () => void) {
  exitListeners.add(listener);
  return () => {
    exitListeners.delete(listener);
  };
}
const pendingUploads = new Map<symbol, string>();
/** Upload remains pending until its resulting document mutation is captured. */
export function beginEditorUpload(noteId: string) {
  if (exitLocked) throw new Error('desktop exit in progress');
  const token = Symbol();
  pendingUploads.set(token, noteId);
  let complete = false;
  return () => {
    if (!complete) {
      complete = true;
      pendingUploads.delete(token);
    }
  };
}

/** The user confirmed deleting the entire note, including pending attachments. */
export function discardEditorUploads(noteId: string) {
  for (const [token, id] of pendingUploads) if (id === noteId) pendingUploads.delete(token);
}
