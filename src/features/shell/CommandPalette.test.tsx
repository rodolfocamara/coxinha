import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

const navigate = vi.fn();
const pathname = { current: '/notes' };
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useLocation: <T,>(opts: { select: (s: { pathname: string }) => T }) =>
    opts.select({ pathname: pathname.current }),
}));

const storeState = {
  notes: [] as Array<{ id: string; title: string }>,
  newNote: vi.fn(),
  deleteNote: vi.fn(),
};

vi.mock('../../lib/store', () => ({
  useAppStore: <T,>(selector: (s: typeof storeState) => T) => selector(storeState),
}));

import { applyTheme, getThemePreference } from '../../lib/theme';

import { CommandPalette } from './CommandPalette';

function note(id: string, title: string) {
  return { id, title };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
  applyTheme('light');
  navigate.mockReset();
  pathname.current = '/notes';
  storeState.notes = [
    note('a', 'Alpha architecture'),
    note('b', 'Beta meeting'),
    note('c', 'Gamma retro'),
  ];
  storeState.newNote.mockReset();
  storeState.deleteNote.mockReset();
});

describe('CommandPalette', () => {
  it('toggles the applied native theme when auto media reports the opposite', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false }))
    );
    applyTheme('dark');
    expect(getThemePreference()).toBe('auto');
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} />);
    await user.click(screen.getByText('palette.actions.toggleTheme'));
    expect(getThemePreference()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('refreshes the toggle when the applied theme changes while the palette is open', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} />);
    act(() => applyTheme('dark'));
    await user.click(screen.getByText('palette.actions.toggleTheme'));
    expect(getThemePreference()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('returns null when closed', () => {
    const { container } = render(<CommandPalette open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders actions and recent notes when open with empty query', () => {
    render(<CommandPalette open onClose={() => {}} />);
    expect(screen.getByText('palette.actions.newNote')).toBeInTheDocument();
    expect(screen.getByText('palette.actions.openAgenda')).toBeInTheDocument();
    expect(screen.getByText('Alpha architecture')).toBeInTheDocument();
  });

  it('filters notes by typed query', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} />);

    await user.type(screen.getByPlaceholderText('palette.placeholder'), 'meeting');
    expect(screen.getByText('Beta meeting')).toBeInTheDocument();
    expect(screen.queryByText('Alpha architecture')).not.toBeInTheDocument();
  });

  it('navigates to a note when picked', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} />);

    await user.click(screen.getByText('Alpha architecture'));
    expect(navigate).toHaveBeenCalledWith({
      to: '/notes/$noteId',
      params: { noteId: 'a' },
    });
  });

  it('fires the action when an action row is picked', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} />);

    await user.click(screen.getByText('palette.actions.openAgenda'));
    expect(navigate).toHaveBeenCalledWith({ to: '/agenda' });
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    // Type in the input then Escape — the handler is on the dialog itself.
    const input = screen.getByPlaceholderText('palette.placeholder');
    await user.click(input);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('surfaces an empty-state message when nothing matches', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} />);
    await user.type(screen.getByPlaceholderText('palette.placeholder'), 'xyzzz');
    expect(screen.getByText(/palette\.empty/)).toBeInTheDocument();
  });

  it('exposes a Delete-this-note action only on note-detail routes', () => {
    pathname.current = '/notes/b';
    render(<CommandPalette open onClose={() => {}} />);
    expect(screen.getByText('palette.actions.deleteCurrentNote')).toBeInTheDocument();
  });

  it('hides the Delete-this-note action on non-detail routes', () => {
    pathname.current = '/settings';
    render(<CommandPalette open onClose={() => {}} />);
    expect(screen.queryByText('palette.actions.deleteCurrentNote')).not.toBeInTheDocument();
  });

  it('calls deleteNote when the user confirms the row trash icon', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CommandPalette open onClose={() => {}} />);

    // Every note row has a Delete button — grab them all, pick Beta's.
    const buttons = screen.getAllByRole('button', {
      name: 'palette.actions.deleteThisNote',
    });
    expect(buttons).toHaveLength(3);
    await user.click(buttons[1]);

    expect(storeState.deleteNote).toHaveBeenCalledWith('b');
    confirmSpy.mockRestore();
  });

  it('skips deletion when the user cancels the confirm', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<CommandPalette open onClose={() => {}} />);

    const [firstDelete] = screen.getAllByRole('button', {
      name: 'palette.actions.deleteThisNote',
    });
    await user.click(firstDelete);

    expect(storeState.deleteNote).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

it.each([
  ['note_file_missing_or_moved', 'noteRecovery.missingOrMoved'],
  ['note_file_changed_externally', 'noteRecovery.changedExternally'],
  ['note_file_identity_conflict', 'noteRecovery.identityConflict'],
  [
    'session_note_delete_requires_detach\nprotected ownership',
    'editor.sessionNoteDeleteRequiresDetach',
  ],
])('keeps a failed trash action visible with stable guidance for %s', async (code, message) => {
  storeState.deleteNote.mockRejectedValue(new Error(code));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const close = vi.fn();
  try {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={close} />);
    await user.click(screen.getAllByRole('button', { name: 'palette.actions.deleteThisNote' })[1]);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByText('Beta meeting')).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  } finally {
    confirm.mockRestore();
  }
});

it('the Delete-current-note action remains open when continuity rejection needs attention', async () => {
  pathname.current = '/notes/b';
  storeState.deleteNote.mockRejectedValue('note_file_changed_externally');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const close = vi.fn();
  try {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={close} />);
    await user.click(screen.getByText('palette.actions.deleteCurrentNote'));
    expect(await screen.findByRole('alert')).toHaveTextContent('noteRecovery.changedExternally');
    expect(close).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  } finally {
    confirm.mockRestore();
  }
});
