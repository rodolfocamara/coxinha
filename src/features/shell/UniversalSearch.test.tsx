import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../lib/i18n';
import type { UniversalAnswer } from '../search/universalSearch';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useLocation: <T,>(opts: { select: (s: { pathname: string }) => T }) =>
    opts.select({ pathname: '/' }),
}));
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }));
vi.mock('../capture/captureActions', () => ({ toggleCapture: vi.fn() }));
const storeState = {
  notes: [{ id: 'local', title: 'Backend roadmap', path: 'notes/local.md' }],
  newNote: vi.fn(),
  deleteNote: vi.fn(),
};
vi.mock('../../lib/store', () => ({
  useAppStore: <T,>(selector: (s: typeof storeState) => T) => selector(storeState),
}));

import { CommandPalette } from './CommandPalette';
import { resetSystemChords } from '../../lib/shortcuts';

const answer: UniversalAnswer = {
  notes: [
    { id: 'local', title: 'Backend roadmap', snippet: null, tier: 0, activity: false },
    { id: 'act', title: 'Plan', snippet: 'who builds the backend', tier: 3, activity: true },
  ],
  meetings: [
    {
      id: 's1',
      title: 'Backend sync',
      startsAt: '2026-11-03T13:00:00Z',
      matches: [
        { field: 'title', snippet: 'Backend sync' },
        { field: 'transcript', snippet: 'Ana: the backend of Digital 360', atMs: 65_000 },
      ],
    },
  ],
  events: [],
  people: [{ id: 'p1', name: 'Bea Backend', alias: null, tier: 0 }],
};

const input = () => screen.getByRole('combobox', { name: /Search notes, meetings/ });
const groupNames = () =>
  screen.getAllByRole('group').map((g) => within(g).getByRole('heading').textContent);
const active = () => document.getElementById(input().getAttribute('aria-activedescendant')!);

beforeEach(async () => {
  await i18n.changeLanguage('en');
  navigate.mockReset();
  resetSystemChords();
  invoke.mockReset();
  invoke.mockImplementation(async (command: string, args?: { query: string }) => {
    if (command === 'get_config') return null;
    if (command === 'universal_search' && args?.query === 'backend') return answer;
    throw new Error(`unexpected ${command}`);
  });
});

async function search(text: string) {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<CommandPalette open onClose={onClose} />);
  await user.type(input(), text);
  await screen.findByRole('group', { name: 'Transcripts' });
  return { user, onClose };
}

describe('universal search palette (spec 0122)', () => {
  it('groups notes, meetings, transcripts and people in one ranked, announced list', async () => {
    await search('backend');
    expect(invoke).toHaveBeenCalledWith('universal_search', { query: 'backend', limit: 20 });
    // Debounced: one backend call for the whole word.
    expect(invoke.mock.calls.filter(([c]) => c === 'universal_search')).toHaveLength(1);
    expect(groupNames()).toEqual(['Notes', 'Meetings', 'People', 'Transcripts']);
    const notes = screen.getByRole('group', { name: 'Notes' });
    expect(within(notes).getAllByRole('option')).toHaveLength(2);
    expect(within(notes).getByText('Activity')).toBeInTheDocument();
    const transcript = within(screen.getByRole('group', { name: 'Transcripts' })).getByRole(
      'option'
    );
    expect(transcript).toHaveTextContent('Backend sync');
    expect(transcript).toHaveTextContent('1:05');
    expect(transcript.querySelector('mark')).toHaveTextContent('backend');
    expect(screen.getByRole('status')).toHaveTextContent('5 results');
    expect(screen.getByRole('listbox')).toHaveAttribute(
      'id',
      input().getAttribute('aria-controls')
    );
  });

  it('moves with the arrows and opens the transcript at the moment with Enter', async () => {
    const { user, onClose } = await search('backend');
    expect(active()).toHaveTextContent('Backend roadmap');
    expect(active()).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(active()).toHaveTextContent('Ana: the backend');
    await user.keyboard('{ArrowUp}{ArrowDown}{Enter}');
    expect(onClose).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({
      to: '/meetings/$sessionId',
      params: { sessionId: 's1' },
      search: { panel: 'transcript', find: 'backend' },
    });
  });

  it.each([
    [0, { to: '/workspace/$noteId', params: { noteId: 'local' } }],
    [2, { to: '/meetings/$sessionId', params: { sessionId: 's1' } }],
    [3, { to: '/people', search: { person: 'p1', name: 'Bea Backend' } }],
  ])('opens result %i in its own view', async (downs, target) => {
    const { user } = await search('backend');
    await user.keyboard('{ArrowDown}'.repeat(downs) + '{Enter}');
    expect(navigate).toHaveBeenCalledWith(target);
  });

  it('closes on Escape and hands focus back to the opener', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    render(<CommandPalette open onClose={onClose} />);
    await waitFor(() => expect(input()).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('answers note titles at once and nothing from a failed backend', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} />);
    await user.type(input(), 'roadmap');
    expect(screen.getByRole('option', { name: /Backend roadmap/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Searching…');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 result'));
    expect(screen.queryByRole('group', { name: 'Meetings' })).toBeNull();
  });
});
