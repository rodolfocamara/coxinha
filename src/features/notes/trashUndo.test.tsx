import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { useAppStore } from '../../lib/store';
import { TrashUndoBar } from './TrashUndoBar';
import { moveNoteToTrash, TRASH_UNDO_MS, undoTrash, useTrashUndo } from './trashUndo';

const restoreNote = vi.fn();
const deleteNote = vi.fn();
const note = { id: 'n1', title: 'Budget' };

beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  restoreNote.mockReset().mockResolvedValue({ id: 'n1' });
  deleteNote.mockReset().mockResolvedValue(undefined);
  useAppStore.setState({ restoreNote } as never);
  useTrashUndo.setState({ pending: null, failed: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('moves the note at once, without a native dialog, and offers the undo', async () => {
  const confirm = vi.spyOn(window, 'confirm');
  render(<TrashUndoBar />);
  await act(() => moveNoteToTrash(note, deleteNote));
  expect(deleteNote).toHaveBeenCalledWith('n1');
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('“Budget” went to the trash.');
  confirm.mockRestore();
});

it('the button restores the note', async () => {
  render(<TrashUndoBar />);
  await act(() => moveNoteToTrash(note, deleteNote));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  });
  expect(restoreNote).toHaveBeenCalledWith('n1');
  expect(screen.queryByRole('status')).toBeNull();
});

it('Mod+Z restores while the offer stands, and is left alone afterwards', async () => {
  render(<TrashUndoBar />);
  expect(fireEvent.keyDown(window, { key: 'z', ctrlKey: true })).toBe(true);
  await act(() => moveNoteToTrash(note, deleteNote));
  await act(async () => {
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
  });
  expect(restoreNote).toHaveBeenCalledOnce();
  expect(fireEvent.keyDown(window, { key: 'z', ctrlKey: true })).toBe(true);
});

it('the offer ends after its time', async () => {
  render(<TrashUndoBar />);
  await act(() => moveNoteToTrash(note, deleteNote));
  act(() => void vi.advanceTimersByTime(TRASH_UNDO_MS));
  expect(screen.queryByRole('status')).toBeNull();
  await undoTrash();
  expect(restoreNote).not.toHaveBeenCalled();
});

it('a refused move leaves nothing to undo and reaches the caller', async () => {
  deleteNote.mockRejectedValue(new Error('note_file_missing_or_moved'));
  render(<TrashUndoBar />);
  await expect(moveNoteToTrash(note, deleteNote)).rejects.toThrow();
  expect(screen.queryByRole('status')).toBeNull();
});

it('a failed restore is said out loud', async () => {
  restoreNote.mockRejectedValue(new Error('gone'));
  render(<TrashUndoBar />);
  await act(() => moveNoteToTrash(note, deleteNote));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Could not bring the note back');
});
