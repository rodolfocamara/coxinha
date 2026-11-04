import { fireEvent, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useNoteShortcuts } from './useNoteShortcuts';

function setup() {
  const actions = { toggleMenu: vi.fn(), copyLink: vi.fn(), duplicate: vi.fn() };
  const view = renderHook(() => useNoteShortcuts(actions));
  return { actions, ...view };
}

it.each([
  ['.', 'toggleMenu'],
  ['l', 'copyLink'],
  ['d', 'duplicate'],
  ['L', 'copyLink'],
] as const)('Ctrl+%s runs %s and keeps the key from the webview', (key, action) => {
  const { actions } = setup();
  const notPrevented = fireEvent.keyDown(window, { key, ctrlKey: true });
  expect(actions[action]).toHaveBeenCalledOnce();
  expect(notPrevented).toBe(false);
});

it('Cmd works as Ctrl', () => {
  const { actions } = setup();
  fireEvent.keyDown(window, { key: 'l', metaKey: true });
  expect(actions.copyLink).toHaveBeenCalledOnce();
});

it('ignores plain typing, other chords and keys already handled', () => {
  const { actions } = setup();
  fireEvent.keyDown(window, { key: 'l' });
  fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: true });
  fireEvent.keyDown(window, { key: 'x', ctrlKey: true });
  const handled = new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, cancelable: true });
  handled.preventDefault();
  window.dispatchEvent(handled);
  for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
});

it('stops listening on unmount', () => {
  const { actions, unmount } = setup();
  unmount();
  fireEvent.keyDown(window, { key: 'l', ctrlKey: true });
  expect(actions.copyLink).not.toHaveBeenCalled();
});
