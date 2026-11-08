import { cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { Outlet } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import {
  before,
  invited,
  openPeek as open,
  primaries,
  signals,
  team,
} from './meetingDetail.harness';
import {
  at,
  backend,
  event,
  freshDb,
  propRow,
  propValue,
  resetState,
  session,
  type Db,
} from './meetingsHub.harness';

vi.mock('../../routes/__root', () => ({ RootLayout: () => <Outlet /> }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
  convertFileSrc: (path: string) => path,
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('../notes/NoteEditor', () => ({
  NoteEditor: () => <div role="textbox" aria-label="Meeting notes" />,
  NoteLoadingSkeleton: () => <p>Loading editor</p>,
}));
vi.mock('../meetings/ProcessingPanel', () => ({
  ProcessingPanel: () => <p>Pipeline</p>,
}));

const TEAMS = [
  '_'.repeat(60),
  'Reunião do Microsoft Teams',
  'Ingressar: https://teams.microsoft.com/meet/000?p=FAKE',
  'ID da Reunião: 000 000 000',
  'Senha: FAKE123',
  '_'.repeat(32),
].join('\n');

let db: Db;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 15, 12));
  resetState();
  await i18n.changeLanguage('en');
  db = freshDb();
  db.account = 'me@example.com';
  vi.mocked(invoke).mockImplementation(backend(db) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('keeps what a person wrote behind the Invitation row, and never the Teams block', async () => {
  db.events = [
    invited(team, { id: 'e', title: 'Sync', bodyPreview: `Bring the numbers.\n${TEAMS}` }),
  ];
  const panel = await open(/Sync/, 'Sync');
  const toggle = within(panel).getByRole('button', { name: /Invitation/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(within(panel).getByText('Bring the numbers.')).not.toBeVisible();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(within(panel).getByText('Bring the numbers.')).toBeVisible();
  expect(panel.textContent).not.toMatch(/FAKE|000 000|teams\.microsoft|____/);
});

it('has no Invitation row when only the Teams block was there', async () => {
  db.events = [invited(team, { id: 'e', title: 'Sync', bodyPreview: TEAMS })];
  const panel = await open(/Sync/, 'Sync');
  expect(within(panel).queryByRole('button', { name: /Invitation/ })).toBeNull();
  expect(panel.querySelector('.ch-event-preview')).toBeNull();
});

it('leads an upcoming meeting with join, then its rows, people and the invitation', async () => {
  db.events = [
    invited(team, {
      id: 'e',
      title: 'Sync',
      response: 'accepted',
      location: 'Reuniões do Microsoft Teams',
      organizer: { name: 'Ana Lima', email: null },
      joinUrl: 'https://teams.microsoft.com/l/x',
      bodyPreview: 'Bring the numbers.',
    }),
  ];
  const panel = await open(/Sync/, 'Sync');
  expect(primaries(panel)).toEqual(['Join in Teams']);
  const head = panel.querySelector('.ch-peek-head')!;
  expect(within(head as HTMLElement).getByRole('button', { name: 'Join in Teams' })).toBeTruthy();
  expect(within(head as HTMLElement).getByText('tomorrow')).toBeInTheDocument();
  // The placeholder says nothing next to the button that joins.
  expect(within(panel).queryByText(/Reuniões do Microsoft Teams/)).toBeNull();
  expect(propValue(panel, 'Organizer')).toHaveTextContent('Ana Lima');
  expect(propValue(panel, 'Response')).toHaveTextContent('Accepted');

  before(propRow(panel, 'Response'), propRow(panel, 'Preparation'));
  before(propRow(panel, 'Preparation'), propRow(panel, 'Invited'));
  before(propRow(panel, 'Invited'), propRow(panel, 'Invitation'));
  expect(propValue(panel, 'Preparation')).toHaveTextContent('None');
  // Prepare is there, without competing with join.
  expect(within(panel).getByRole('button', { name: 'Prepare' })).toHaveAttribute(
    'data-variant',
    'secondary'
  );
});

it('leads with preparing when there is nothing to join', async () => {
  db.events = [invited(team, { id: 'e', title: 'Sync' })];
  const panel = await open(/Sync/, 'Sync');
  expect(primaries(panel)).toEqual(['Prepare']);
  expect(propValue(panel, 'Preparation')).toHaveTextContent('None');
});

it('counts what a prepared meeting has, and opens the note and the files from there', async () => {
  db.sessions = [
    session({
      id: 'p',
      title: 'Prepared',
      starts_at: at(1, 9),
      ends_at: at(1, 10),
      personal_note: { id: 'n1', relative_path: 'notes/session-n1.md' },
    }),
  ];
  db.signals = { summariesOn: false, sessions: [signals('p', { note: true, preparation: true })] };
  db.itemFiles = {
    folder: '/tmp/p',
    files: [{ name: 'plan.pdf', kind: 'pdf', bytes: 1, modified: 'now' }],
    references: [
      {
        target: 'https://example.test',
        label: 'Deck',
        addedAt: 'now',
        isUrl: true,
        missing: false,
      },
    ],
  };
  const panel = await open(/Prepared/, 'Prepared');
  const text = await within(panel).findByText('Agenda text');
  await waitFor(() =>
    expect(propValue(panel, 'Preparation')).toHaveTextContent('Note · 1 file · 1 link')
  );
  expect(text).not.toBeVisible();
  fireEvent.click(
    within(propRow(panel, 'Preparation')).getByRole('button', { name: /Preparation/ })
  );
  expect(text).toBeVisible();
  expect(within(panel).getByRole('button', { name: 'plan.pdf' })).toBeVisible();
  expect(within(panel).getByRole('button', { name: 'Deck' })).toBeVisible();
});

it('says a block with no invitees is only on the calendar', async () => {
  db.events = [event({ id: 'e', title: 'Focus' })];
  const panel = await open(/Focus/, 'Focus');
  expect(propValue(panel, 'Invited')).toHaveTextContent('None · only on your calendar');
  expect(within(panel).queryByText('Preparation')).toBeNull();
  expect(
    within(panel)
      .queryByRole('button', { name: /Prepare/ })
      ?.getAttribute('data-variant')
  ).toBe('primary');
});

it.each([
  ['declined', { response: 'declined' as const }],
  ['cancelled', { cancelled: true }],
])('asks nothing of a %s event but keeps join reachable', async (_, o) => {
  db.events = [
    invited(team, { id: 'e', title: 'Sync', joinUrl: 'https://teams.microsoft.com/l/x', ...o }),
  ];
  const panel = await open(/Sync/, 'Sync');
  expect(primaries(panel)).toEqual([]);
  expect(within(panel).getByRole('button', { name: 'Join in Teams' })).toHaveAttribute(
    'data-variant',
    'secondary'
  );
});

it('strikes the title of a declined event', async () => {
  db.events = [invited(team, { id: 'e', title: 'Sync', response: 'declined' })];
  const panel = await open(/Sync/, 'Sync');
  expect(within(panel).getByRole('heading', { level: 2 })).toHaveAttribute('data-look', 'declined');
  expect(propValue(panel, 'Response')).toHaveTextContent('Declined');
});

it('moves focus to the title on open and reads on to the close button and the action', async () => {
  db.events = [
    invited(team, { id: 'e', title: 'Sync', joinUrl: 'https://teams.microsoft.com/l/x' }),
  ];
  const panel = await open(/Sync/, 'Sync');
  const title = within(panel).getByRole('heading', { level: 2 });
  await waitFor(() => expect(document.activeElement).toBe(title));
  const controls = [...panel.querySelectorAll('button')];
  expect(controls[0]).toBe(within(panel).getByRole('button', { name: 'Close preview' }));
  expect(controls[1]).toBe(within(panel).getByRole('button', { name: 'Join in Teams' }));
  before(title, controls[0]);
});
