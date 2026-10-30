import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { useAppStore } from '../../lib/store';
import { deleteAfterPendingSaves } from '../../lib/noteSessions';
import { CommandPalette } from './CommandPalette';
const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useLocation: <T,>({ select }: { select: (s: { pathname: string }) => T }) =>
    select({ pathname: '/notes/personal' }),
}));
vi.mock('../../lib/useTheme', () => ({ useResolvedTheme: () => 'light' }));
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await deleteAfterPendingSaves('personal', async () => {});
  useAppStore.setState({ notes: [], activeNoteId: null });
  await i18n.changeLanguage('en');
});
it.each(['en', 'pt-BR'])(
  'keeps the personal note and shows localized backend refusal in palette (%s)',
  async (language) => {
    await i18n.changeLanguage(language);
    navigate.mockClear();
    const note = {
      id: 'personal',
      title: 'Private notes',
      tags: [],
      path: 'notes/personal.md',
      created_at: '',
      updated_at: '',
    };
    useAppStore.setState({ notes: [note], activeNoteId: note.id });
    vi.mocked(invoke).mockRejectedValue(
      new Error('session_note_delete_requires_detach\nprotected session note')
    );
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const close = vi.fn();
    render(<CommandPalette open onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('palette.actions.deleteThisNote') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('editor.sessionNoteDeleteRequiresDetach')
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('protected session note');
    expect(confirm).toHaveBeenCalledWith(i18n.t('palette.deleteConfirm', { title: note.title }));
    if (language === 'pt-BR') expect(confirm.mock.calls[0][0]).toMatch(/^Excluir/);
    expect(invoke).toHaveBeenCalledWith('delete_note', { id: note.id });
    expect(useAppStore.getState().notes).toEqual([note]);
    expect(useAppStore.getState().activeNoteId).toBe(note.id);
    expect(close).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  }
);
