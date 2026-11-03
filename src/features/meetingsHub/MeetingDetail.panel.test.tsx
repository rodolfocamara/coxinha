import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Outlet } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import type { AttendeeResponse, CalendarEvent } from '../agenda/calendar';
import type { MeetingSignals } from '../meetings/library';
import {
  at,
  backend,
  event,
  freshDb,
  recording,
  renderAt,
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

const person = (
  name: string,
  response: AttendeeResponse['response'],
  kind: AttendeeResponse['kind'] = 'required'
): AttendeeResponse => ({ name, email: `${name.split(' ')[0]}@example.test`, response, kind });

const invited = (
  people: AttendeeResponse[],
  o: Partial<CalendarEvent> & { id: string; title: string }
) =>
  event({
    attendees: people.map(({ name, email }) => ({ name, email })),
    attendeeResponses: people,
    ...o,
  });

const team = [
  person('Ana Lima', 'organizer'),
  person('Bruno Dias', 'accepted'),
  person('Carla Reis', 'tentativelyAccepted', 'optional'),
  person('Diego Melo', 'notResponded'),
];

const signals = (sessionId: string, o: Partial<MeetingSignals> = {}): MeetingSignals => ({
  sessionId,
  transcript: false,
  speakers: { named: 0, unnamed: 0 },
  note: false,
  preparation: false,
  diagram: false,
  summary: false,
  followUps: { linked: 0, actions: 0 },
  generatedContent: false,
  mark: null,
  ...o,
});

const recorded = () =>
  session({
    id: 'rec',
    title: 'Recorded sync',
    starts_at: at(-1, 9),
    ends_at: at(-1, 10),
    status: 'completed',
    meeting_id: 'm-rec',
    recording: recording('m-rec', 'Recorded sync'),
    transcript_status: 'available',
    processing_state: 'succeeded',
  });

const speakers = (names: string[]) => ({
  jobs: [],
  people: [],
  report: {
    job: 'j',
    turns: [],
    warnings: [],
    corrections: {},
    segments: [{ id: 'a', track: 'mic', start_ms: 0, end_ms: 1, text: 'hello', speaker: 's0' }],
    assignments: names.map((name, i) => ({
      id: `a${i}`,
      speaker: `s${i}`,
      track: 'mic',
      person_id: `p${i}`,
      state: 'confirmed',
      name,
    })),
  },
});

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

const open = async (title: RegExp, name: string) => {
  renderAt('/meetings?view=week');
  await screen.findByRole('heading', { name: /October/ });
  const grid = document.querySelector<HTMLElement>('.ch-main')!;
  fireEvent.click(await within(grid).findByRole('button', { name: title }));
  return screen.findByRole('complementary', { name });
};
const primaries = (panel: HTMLElement) =>
  [...panel.querySelectorAll('[data-variant="primary"]')].map((b) => b.textContent);
const before = (a: Element, b: Element) =>
  expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

it('shows what a person wrote in the invitation and never the Teams block', async () => {
  db.events = [
    invited(team, { id: 'e', title: 'Sync', bodyPreview: `Bring the numbers.\n${TEAMS}` }),
  ];
  const panel = await open(/Sync/, 'Sync');
  expect(within(panel).getByRole('heading', { name: 'Invitation' })).toBeInTheDocument();
  expect(within(panel).getByText('Bring the numbers.')).toBeInTheDocument();
  expect(panel.textContent).not.toMatch(/FAKE|000 000|teams\.microsoft|____/);
});

it('shows no preview when only the Teams block was there', async () => {
  db.events = [invited(team, { id: 'e', title: 'Sync', bodyPreview: TEAMS })];
  const panel = await open(/Sync/, 'Sync');
  expect(within(panel).queryByRole('heading', { name: 'Invitation' })).toBeNull();
  expect(panel.querySelector('.ch-event-preview')).toBeNull();
});

it('leads an upcoming meeting with join, then who is coming and preparation', async () => {
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
  expect(within(panel).getByText('Organized by Ana Lima')).toBeInTheDocument();

  const response = within(panel).getByText('Your response: accepted');
  const coming = within(panel).getByRole('heading', { name: 'Who is coming' });
  const preparation = within(panel).getByRole('heading', { name: 'Preparation' });
  const invitation = within(panel).getByRole('heading', { name: 'Invitation' });
  before(response, coming);
  before(coming, preparation);
  before(preparation, invitation);
  expect(within(panel).getByText('No preparation')).toBeInTheDocument();
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
  expect(within(panel).queryByRole('heading', { name: 'Preparation' })).not.toBeNull();
});

it('shows the notes of a prepared meeting that has no recording yet', async () => {
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
  const panel = await open(/Prepared/, 'Prepared');
  expect(await within(panel).findByText('Agenda text')).toBeInTheDocument();
  expect(await within(panel).findByText('Prepared beforehand')).toBeInTheDocument();
});

it('says a block with no invitees is only on the calendar', async () => {
  db.events = [event({ id: 'e', title: 'Focus' })];
  const panel = await open(/Focus/, 'Focus');
  expect(within(panel).getByText(/No invitees/)).toBeInTheDocument();
  expect(within(panel).queryByRole('heading', { name: 'Who is coming' })).toBeNull();
  expect(within(panel).queryByText('No preparation')).toBeNull();
});

it('leads a past meeting with what came out, then people, the mark and memory', async () => {
  db.sessions = [recorded()];
  db.events = [
    invited(team, {
      id: 'e',
      title: 'Recorded sync',
      startsAt: at(-1, 9),
      endsAt: at(-1, 10),
      joinUrl: 'https://teams.microsoft.com/l/x',
      location: 'Room 4',
      bodyPreview: 'Bring the numbers.',
    }),
  ];
  db.summaries['m-rec'] = { markdown: '- Ship it', generatedAt: 'now' };
  db.processing['m-rec'] = speakers(['Bruno Dias', 'Outside Guest']) as never;
  db.signals = {
    summariesOn: false,
    sessions: [signals('rec', { summary: true, transcript: true })],
  };
  const panel = await open(/Recorded sync/, 'Recorded sync');
  expect(primaries(panel)).toEqual(['Open meeting']);
  expect(within(panel).queryByRole('button', { name: 'Join in Teams' })).toBeNull();

  const summary = await within(panel).findByRole('heading', { name: 'Summary' });
  const came = await within(panel).findByRole('heading', { name: 'Confirmed on the recording' });
  const invitedHeading = within(panel).getByRole('heading', { name: 'Who was invited' });
  const mark = await within(panel).findByRole('heading', { name: 'Was this meeting worth it?' });
  const memory = within(panel).getByRole('heading', { name: 'Memory' });
  before(summary, came);
  before(came, invitedHeading);
  before(invitedHeading, mark);
  before(mark, memory);
  before(memory, within(panel).getByText('Room 4'));
  expect(panel.querySelector('[data-outcome]')).toContainElement(summary);

  // Who came and who was invited stay apart; a confirmed invitee is marked.
  const rows = [...panel.querySelectorAll<HTMLElement>('.ch-person')];
  const bruno = rows.filter((row) => row.textContent?.includes('Bruno Dias'));
  expect(bruno).toHaveLength(2);
  expect(within(bruno[1]).getByText('Confirmed on the recording')).toBeInTheDocument();
  const ana = rows.find((row) => row.textContent?.includes('Ana Lima'))!;
  expect(within(ana).queryByText('Confirmed on the recording')).toBeNull();
  expect(rows.filter((row) => row.textContent?.includes('Outside Guest'))).toHaveLength(1);

  // The invitation is out of the way, and its control says so.
  const toggle = within(panel).getByRole('button', { name: 'Invitation' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(within(panel).getByText('Bring the numbers.')).not.toBeVisible();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(within(panel).getByText('Bring the numbers.')).toBeVisible();
});

it('says out loud when a past meeting produced nothing', async () => {
  db.sessions = [
    session({ id: 'x', title: 'Empty one', starts_at: at(-1, 9), ends_at: at(-1, 10) }),
  ];
  db.signals = { summariesOn: false, sessions: [signals('x')] };
  const panel = await open(/Empty one/, 'Empty one');
  expect(await within(panel).findByText(/Nothing came out of this meeting/)).toBeInTheDocument();
  expect(panel.querySelector('[data-outcome]')).not.toBeNull();
});

it('does not claim nothing came out when the meeting has files', async () => {
  db.sessions = [
    session({ id: 'x', title: 'With a file', starts_at: at(-1, 9), ends_at: at(-1, 10) }),
  ];
  db.signals = { summariesOn: false, sessions: [signals('x')] };
  db.itemFiles = {
    folder: '/tmp/x',
    files: [{ name: 'plan.pdf', kind: 'pdf', bytes: 1, modified: 'now' }],
    references: [],
  };
  const panel = await open(/With a file/, 'With a file');
  expect(await within(panel).findByRole('button', { name: 'plan.pdf' })).toBeInTheDocument();
  expect(within(panel).getByText('1 file')).toBeInTheDocument();
  expect(within(panel).queryByText(/Nothing came out/)).toBeNull();
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
  expect(within(panel).getByText('Your response: declined')).toBeInTheDocument();
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
