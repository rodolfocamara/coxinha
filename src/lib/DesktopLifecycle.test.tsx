import { act, render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DesktopLifecycle } from './DesktopLifecycle';
import {
  beginEditorUpload,
  isExitLocked,
  registerSaveParticipant,
  setExitLocked,
} from './lifecycle';
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listenerWaits: new Map<string, Promise<void>>(),
  handlers: new Map<string, (event: { payload: unknown }) => Promise<void> | void>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name, callback) => {
    mocks.handlers.set(name, callback);
    await mocks.listenerWaits.get(name);
    return () => mocks.handlers.delete(name);
  }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanup();
  cleanups.splice(0).forEach((f) => f());
  setExitLocked(false);
  mocks.handlers.clear();
  mocks.listenerWaits.clear();
  mocks.invoke.mockReset();
  vi.useRealTimers();
});
async function start() {
  mocks.invoke.mockResolvedValue(undefined);
  render(
    <>
      <button>Editor</button>
      <DesktopLifecycle />
    </>
  );
  await waitFor(() => expect(mocks.handlers.has('desktop-flush')).toBe(true));
}
async function emit(name: string, payload: unknown) {
  await act(async () => {
    await mocks.handlers.get(name)!({ payload });
  });
}
const recovery = (requestId = 'request', reason = 'save_failed', recoveryId = 'recovery') =>
  emit('desktop-recovery', { requestId, reason, recoveryId });
it('flushes directly without a prompt, waits for durable acknowledgement and stays locked', async () => {
  let resolve!: () => void;
  cleanups.push(
    registerSaveParticipant(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    )
  );
  await start();
  let flush!: Promise<void> | void;
  await act(async () => {
    flush = mocks.handlers.get('desktop-flush')!({ payload: 'request' });
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  expect(isExitLocked()).toBe(true);
  expect(mocks.invoke).toHaveBeenCalledWith('desktop_flush_started', { requestId: 'request' });
  expect(mocks.invoke).not.toHaveBeenCalledWith('desktop_flush_result', expect.anything());
  await act(async () => {
    resolve();
    await flush;
  });
  expect(mocks.invoke).toHaveBeenCalledWith('desktop_flush_result', {
    requestId: 'request',
    success: true,
    reason: null,
  });
  expect(isExitLocked()).toBe(true);
  await emit('desktop-exit-aborted', 'stale');
  expect(isExitLocked()).toBe(true);
  await emit('desktop-exit-aborted', 'request');
  expect(isExitLocked()).toBe(false);
});
it('shows centered recovery with working keyboard/buttons while the background is inert, then restores focus', async () => {
  cleanups.push(
    registerSaveParticipant(async () => {
      throw Error('private note');
    })
  );
  await start();
  const editor = screen.getByText('Editor');
  editor.focus();
  await emit('desktop-flush', 'request');
  await recovery();
  const dialog = screen.getByRole('dialog');
  expect(dialog.parentElement).toHaveClass('fixed', 'inset-0', 'items-center', 'justify-center');
  expect(editor.closest('[inert]')).not.toBeNull();
  expect(screen.getByText('desktopRecovery.keepOpen')).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
  expect(screen.getByText('desktopRecovery.discardExit')).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
  expect(screen.getByText('desktopRecovery.keepOpen')).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith('desktop_recovery_response', {
      requestId: 'request',
      recoveryId: 'recovery',
      action: 'cancel',
    })
  );
  expect(isExitLocked()).toBe(true);
  await emit('desktop-exit-aborted', 'request');
  expect(editor.closest('[inert]')).toBeNull();
  expect(editor).toHaveFocus();
  expect(JSON.stringify(mocks.invoke.mock.calls)).not.toContain('private note');
});
it('deduplicates repeated close, retains late acknowledgement after delay and rejects stale recovery', async () => {
  let resolve!: () => void;
  const saver = vi.fn(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  cleanups.push(registerSaveParticipant(saver));
  await start();
  let flush!: Promise<void> | void;
  await act(async () => {
    flush = mocks.handlers.get('desktop-flush')!({ payload: 'request' });
  });
  await emit('desktop-flush', 'request');
  expect(saver).toHaveBeenCalledOnce();
  await recovery('stale');
  expect(screen.queryByRole('dialog')).toBeNull();
  await recovery('request', 'flush_delayed');
  expect(screen.getByText('desktopRecovery.delayed')).toBeInTheDocument();
  await act(async () => {
    resolve();
    await flush;
  });
  expect(isExitLocked()).toBe(true);
  fireEvent.click(screen.getByText('desktopRecovery.retry'));
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith('desktop_recovery_response', {
      requestId: 'request',
      recoveryId: 'recovery',
      action: 'retry',
    })
  );
  expect(isExitLocked()).toBe(true);
});
it('reports pending attachments, retries a new request without unlocking, and warns before explicit discard', async () => {
  const finish = beginEditorUpload('test');
  cleanups.push(finish);
  await start();
  await emit('desktop-flush', 'request');
  await recovery('request', 'attachment_pending');
  expect(mocks.invoke).toHaveBeenCalledWith('desktop_flush_result', {
    requestId: 'request',
    success: false,
    reason: 'attachment_pending',
  });
  expect(screen.getByText('desktopRecovery.discardWarning')).toBeInTheDocument();
  fireEvent.click(screen.getByText('desktopRecovery.retry'));
  finish();
  await emit('desktop-flush', 'retry');
  expect(isExitLocked()).toBe(true);
  await recovery('retry');
  fireEvent.click(screen.getByText('desktopRecovery.discardExit'));
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith('desktop_recovery_response', {
      requestId: 'retry',
      recoveryId: 'recovery',
      action: 'discard',
    })
  );
  expect(isExitLocked()).toBe(true);
});
it('shows saving only after a delay and does not treat UI receipt as completion', async () => {
  await start();
  vi.useFakeTimers();
  cleanups.push(registerSaveParticipant(() => new Promise<void>(() => {})));
  await act(async () => {
    void mocks.handlers.get('desktop-flush')!({ payload: 'request' });
  });
  expect(screen.queryByRole('status')).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(750);
  });
  expect(screen.getByRole('status')).toBeInTheDocument();
  expect(mocks.invoke).not.toHaveBeenCalledWith('desktop_flush_result', expect.anything());
});
it('logs only frontend categories and source coordinates', async () => {
  await start();
  window.dispatchEvent(new ErrorEvent('error', { message: 'private note', lineno: 12, colno: 4 }));
  expect(mocks.invoke).toHaveBeenCalledWith('desktop_diagnostic', {
    category: 'frontend_error',
    line: 12,
    column: 4,
  });
  expect(JSON.stringify(mocks.invoke.mock.calls)).not.toContain('private note');
});
it('keeps recovery locked and retryable when the command transport fails', async () => {
  await start();
  await emit('desktop-flush', 'request');
  await recovery();
  mocks.invoke.mockImplementation((name, args) =>
    name === 'desktop_recovery_response' && args.action === 'cancel'
      ? Promise.reject(Error('transport'))
      : Promise.resolve()
  );
  fireEvent.click(screen.getByText('desktopRecovery.keepOpen'));
  await waitFor(() => expect(screen.getByText('desktopRecovery.keepOpen')).toBeEnabled());
  expect(isExitLocked()).toBe(true);
  await emit('desktop-exit-aborted', 'request');
  expect(isExitLocked()).toBe(false);
  await emit('desktop-flush', 'next');
  expect(isExitLocked()).toBe(true);
  expect(mocks.invoke).toHaveBeenCalledWith('desktop_flush_result', {
    requestId: 'next',
    success: true,
    reason: null,
  });
});

it('waits for recovery and abort listeners before acknowledging a retransmitted startup flush', async () => {
  let ready!: () => void;
  mocks.listenerWaits.set(
    'desktop-exit-aborted',
    new Promise<void>((resolve) => {
      ready = resolve;
    })
  );
  await start();
  await emit('desktop-flush', 'startup');
  expect(mocks.invoke).not.toHaveBeenCalledWith('desktop_flush_started', expect.anything());
  expect(isExitLocked()).toBe(false);
  await act(async () => {
    ready();
  });
  await emit('desktop-flush', 'startup');
  expect(mocks.invoke).toHaveBeenCalledWith('desktop_flush_result', {
    requestId: 'startup',
    success: true,
    reason: null,
  });
});
it('ignores late completion after cancellation and permits another close', async () => {
  let resolve!: () => void;
  cleanups.push(
    registerSaveParticipant(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    )
  );
  await start();
  let flush!: Promise<void> | void;
  await act(async () => {
    flush = mocks.handlers.get('desktop-flush')!({ payload: 'cancelled' });
  });
  await emit('desktop-exit-aborted', 'cancelled');
  await act(async () => {
    resolve();
    await flush;
  });
  expect(mocks.invoke).not.toHaveBeenCalledWith('desktop_flush_result', expect.anything());
  expect(isExitLocked()).toBe(false);
});

it('rejects retired flush requests without disturbing the current lock', async () => {
  const saver = vi.fn().mockResolvedValue(undefined);
  cleanups.push(registerSaveParticipant(saver));
  await start();
  await emit('desktop-flush', 'first');
  await emit('desktop-flush', 'second');
  await emit('desktop-flush', 'first');
  await emit('desktop-exit-aborted', 'first');
  expect(saver).toHaveBeenCalledTimes(2);
  expect(isExitLocked()).toBe(true);
  await emit('desktop-exit-aborted', 'second');
  expect(isExitLocked()).toBe(false);
});
