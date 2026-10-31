import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => false }));
const toggleCapture = vi.hoisted(() => vi.fn());
vi.mock('../capture/captureActions', () => ({ toggleCapture }));

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
import { resetPaletteShortcuts } from './usePaletteActions';
import { initialCaptureState, useCaptureStore } from '../capture/captureStore';

const SHORTCUTS = {
  new_note: 'Ctrl+Alt+Y',
  open_app: 'Ctrl+Alt+O',
  agenda: 'Ctrl+Alt+G',
  meetings: 'Ctrl+Alt+T',
  toggle_recording: 'Ctrl+Alt+W',
};

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
  toggleCapture.mockReset();
  resetPaletteShortcuts();
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) => {
    if (command === 'get_config') return { vault_path: '/v', shortcuts: SHORTCUTS };
    throw new Error(`unexpected ${command}`);
  });
  useCaptureStore.setState({ ...initialCaptureState });
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
    await user.click(screen.getByText('people.palette.actions.toggleTheme'));
    expect(getThemePreference()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('refreshes the toggle when the applied theme changes while the palette is open', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} />);
    act(() => applyTheme('dark'));
    await user.click(screen.getByText('people.palette.actions.toggleTheme'));
    expect(getThemePreference()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('returns null when closed', () => {
    const { container } = render(<CommandPalette open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders actions, destinations and notes when open with an empty query', () => {
    render(<CommandPalette open onClose={() => {}} />);
    expect(screen.getByText('people.palette.actions.record')).toBeInTheDocument();
    expect(screen.getByText('people.palette.actions.newMeeting')).toBeInTheDocument();
    expect(screen.getByText('people.palette.actions.newNote')).toBeInTheDocument();
    expect(screen.getByText('people.palette.actions.importAudio')).toBeInTheDocument();
    expect(screen.getByText('Alpha architecture')).toBeInTheDocument();
    const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-labelledby'));
    expect(groups).toEqual(['palette-group-actions', 'palette-group-go', 'palette-group-notes']);
  });

  it('filters notes by typed query', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} />);

    await user.type(screen.getByPlaceholderText('people.palette.placeholder'), 'meeting');
    expect(screen.getByText('Beta meeting')).toBeInTheDocument();
    expect(screen.queryByText('Alpha architecture')).not.toBeInTheDocument();
  });

  it('navigates to a note when picked', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} />);

    await user.click(screen.getByText('Alpha architecture'));
    expect(navigate).toHaveBeenCalledWith({
      to: '/workspace/$noteId',
      params: { noteId: 'a' },
    });
  });

  it.each([
    ['shell.nav.hoje', '/'],
    ['shell.nav.meetings', '/meetings'],
    ['shell.nav.workspace', '/workspace'],
    ['shell.nav.people', '/people'],
    ['shell.nav.settings', '/settings'],
  ])('lists the %s destination and navigates to %s', async (label, to) => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    pathname.current = '/people';
    render(<CommandPalette open onClose={onClose} />);
    await user.click(screen.getByText(label));
    expect(onClose).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to }));
  });

  it('Gravar agora toggles capture with a quick title and shows the bound global shortcut', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    const row = screen.getByText('people.palette.actions.record').closest('div')!;
    expect(await within(row).findByText('Ctrl+Alt+W')).toBeInTheDocument();
    expect(
      within(screen.getByText('people.palette.actions.newNote').closest('div')!).getByText(
        'Ctrl+Alt+Y'
      )
    ).toBeInTheDocument();
    await user.click(screen.getByText('people.palette.actions.record'));
    expect(onClose).toHaveBeenCalled();
    expect(toggleCapture).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/^shell\.record\.quickTitle \S+/)
    );
  });

  it('offers to stop instead of record while a capture is live', () => {
    useCaptureStore.setState({
      status: {
        active: {
          meetingId: 'm',
          paused: false,
          elapsedMs: 1,
          mic: { peak: 0, lastBlockMs: null, error: null },
          output: { peak: 0, lastBlockMs: null, error: null },
        },
        error: null,
      },
    });
    render(<CommandPalette open onClose={() => {}} />);
    expect(screen.getByText('people.palette.actions.stop')).toBeInTheDocument();
    expect(screen.queryByText('people.palette.actions.record')).toBeNull();
  });

  it('shows no shortcut hints that are not actually bound', async () => {
    invoke.mockRejectedValue(new Error('no desktop'));
    render(<CommandPalette open onClose={() => {}} />);
    await act(async () => {});
    for (const hint of ['Ctrl+Alt+W', 'Ctrl+Alt+Y', 'Ctrl+N', 'Ctrl+,', 'Win+Shift+A'])
      expect(screen.queryByText(hint)).toBeNull();
  });

  it.each([
    ['people.palette.actions.newMeeting', 'coxinha:new-meeting'],
    ['people.palette.actions.importAudio', 'coxinha:import-audio'],
  ])('%s opens Reuniões and then asks it via %s', async (label, event) => {
    const user = userEvent.setup();
    const heard = vi.fn();
    window.addEventListener(event, heard);
    try {
      render(<CommandPalette open onClose={() => {}} />);
      await user.click(screen.getByText(label));
      expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/meetings' }));
      await waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    } finally {
      window.removeEventListener(event, heard);
    }
  });

  it('Nova nota creates a note and opens it in the Workspace', async () => {
    const user = userEvent.setup();
    storeState.newNote.mockResolvedValue({ id: 'n-new', title: '' });
    render(<CommandPalette open onClose={() => {}} />);
    await user.click(screen.getByText('people.palette.actions.newNote'));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/workspace/$noteId',
        params: { noteId: 'n-new' },
      })
    );
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    // Type in the input then Escape — the handler is on the dialog itself.
    const input = screen.getByPlaceholderText('people.palette.placeholder');
    await user.click(input);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('surfaces an empty-state message when nothing matches', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} />);
    await user.type(screen.getByPlaceholderText('people.palette.placeholder'), 'xyzzz');
    expect(screen.getByText(/people\.palette\.empty/)).toBeInTheDocument();
  });

  it.each(['/workspace/b', '/notes/b'])(
    'exposes a Delete-this-note action on the note route %s',
    (route) => {
      pathname.current = route;
      render(<CommandPalette open onClose={() => {}} />);
      expect(screen.getByText('people.palette.actions.deleteCurrentNote')).toBeInTheDocument();
    }
  );

  it('hides the Delete-this-note action on non-detail routes', () => {
    pathname.current = '/settings';
    render(<CommandPalette open onClose={() => {}} />);
    expect(screen.queryByText('people.palette.actions.deleteCurrentNote')).not.toBeInTheDocument();
  });

  it('calls deleteNote when the user confirms the row trash icon', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CommandPalette open onClose={() => {}} />);

    // Every note row has a Delete button — grab them all, pick Beta's.
    const buttons = screen.getAllByRole('button', {
      name: 'people.palette.actions.deleteNote',
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
      name: 'people.palette.actions.deleteNote',
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
    await user.click(
      screen.getAllByRole('button', { name: 'people.palette.actions.deleteNote' })[1]
    );
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
    await user.click(screen.getByText('people.palette.actions.deleteCurrentNote'));
    expect(await screen.findByRole('alert')).toHaveTextContent('noteRecovery.changedExternally');
    expect(close).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  } finally {
    confirm.mockRestore();
  }
});
