import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Outlet } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import type { MeetingSignals } from '../meetings/library';
import {
  at,
  backend,
  calledWith,
  event,
  freshDb,
  propRow,
  propValue,
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

const detailed = () =>
  event({
    id: 'rich',
    title: 'Roadmap sync',
    startsAt: at(1, 9),
    endsAt: at(1, 10),
    response: 'tentativelyAccepted',
    showAs: 'tentative',
    location: 'Room 4',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
    bodyPreview: '<img src=x onerror=alert(1)> Agenda',
    attendees: [
      { name: 'Ana', email: 'ana@example.test' },
      { name: 'Bruno', email: 'bruno@example.test' },
      { name: 'Carla', email: 'carla@example.test' },
      { name: 'Room 4', email: 'room@example.test' },
    ],
    attendeeResponses: [
      { name: 'Ana', email: 'ana@example.test', response: 'accepted', kind: 'required' },
      { name: 'Bruno', email: 'bruno@example.test', response: 'declined', kind: 'optional' },
      { name: 'Carla', email: 'carla@example.test', response: 'notResponded', kind: 'required' },
      { name: 'Room 4', email: 'room@example.test', response: 'accepted', kind: 'resource' },
    ],
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

const week = async () => {
  const router = renderAt('/meetings?view=week');
  await screen.findByRole('heading', { name: /October/ });
  return router;
};
const block = (name: RegExp) => screen.findByRole('button', { name });

it('shows the event details Outlook has, and opens links by event id only', async () => {
  db.events = [detailed()];
  await week();
  fireEvent.click(await block(/Roadmap sync/));
  const peek = await screen.findByRole('complementary', { name: 'Roadmap sync' });
  const details = within(peek);
  expect(propValue(peek, 'Response')).toHaveTextContent('Tentative');
  expect(propValue(peek, 'Location')).toHaveTextContent('Room 4');
  expect(propValue(peek, 'Invited')).toHaveTextContent(/1 yes.*1 no.*1 no answer/);
  expect(details.getByText('Accepted (1)')).toBeInTheDocument();
  expect(details.getByText('Declined (1)')).toBeInTheDocument();
  expect(details.getByText('No answer (1)')).toBeInTheDocument();
  const bruno = details.getByText('Bruno').closest('li')!;
  expect(within(bruno).getByText('Optional')).toBeInTheDocument();
  // A room is the place, not a person.
  expect(details.queryByRole('listitem', { name: /Room 4/ })).toBeNull();
  expect(peek.querySelectorAll('.ch-person')).toHaveLength(3);

  // Text from other people is text: the tag is shown, never parsed.
  expect(details.getByText(/<img src=x/)).toBeInTheDocument();
  expect(peek.querySelector('img')).toBeNull();

  fireEvent.click(details.getByRole('button', { name: 'Join in Teams' }));
  fireEvent.click(details.getByRole('button', { name: 'Open in Outlook' }));
  expect(calledWith(db, 'calendar_open_link')).toEqual([
    { eventId: 'rich', link: 'join' },
    { eventId: 'rich', link: 'outlook' },
  ]);
});

it('offers no join button once the meeting ended or without a join URL', async () => {
  db.events = [
    event({
      id: 'over',
      title: 'Finished sync',
      startsAt: at(-1, 9),
      endsAt: at(-1, 10),
      joinUrl: 'https://teams.microsoft.com/l/x',
    }),
    event({ id: 'plain', title: 'Plain sync', startsAt: at(1, 11), endsAt: at(1, 12) }),
  ];
  await week();
  fireEvent.click(await block(/Finished sync/));
  let peek = await screen.findByRole('complementary', { name: 'Finished sync' });
  expect(within(peek).queryByRole('button', { name: 'Join in Teams' })).toBeNull();
  fireEvent.click(await block(/Plain sync/));
  peek = await screen.findByRole('complementary', { name: 'Plain sync' });
  expect(within(peek).queryByRole('button', { name: 'Join in Teams' })).toBeNull();
  expect(within(peek).getByRole('button', { name: 'Open in Outlook' })).toBeInTheDocument();
});

it('keeps the flat list for a cache without responses and claims no group', async () => {
  db.events = [
    event({
      id: 'old',
      title: 'Older cache',
      attendees: [{ name: 'Ana', email: null }],
    }),
  ];
  await week();
  fireEvent.click(await block(/Older cache/));
  const peek = await screen.findByRole('complementary', { name: 'Older cache' });
  expect(propValue(peek, 'Invited')).toHaveTextContent('1 invitee');
  expect(within(peek).getByText('Ana')).toBeInTheDocument();
  expect(within(peek).queryByText(/No answer/)).toBeNull();
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
const report = (assignments: { state: string; name: string | null }[]) => ({
  jobs: [],
  people: [],
  report: {
    job: 'j',
    segments: [],
    turns: [],
    warnings: [],
    corrections: {},
    assignments: assignments.map((a, i) => ({
      id: `a${i}`,
      speaker: `s${i}`,
      track: 'mic',
      person_id: a.name ? `p${i}` : null,
      ...a,
    })),
  },
});

it('lists confirmed speakers apart from invitees and claims nothing without them', async () => {
  db.sessions = [recorded()];
  db.events = [
    event({
      id: 'e-rec',
      title: 'Recorded sync',
      startsAt: at(-1, 9),
      endsAt: at(-1, 10),
      attendees: [{ name: 'Invited only', email: null }],
    }),
  ];
  db.processing['m-rec'] = report([
    { state: 'confirmed', name: 'Ana' },
    { state: 'confirmed', name: 'Ana' },
    { state: 'suggested', name: 'Bruno' },
  ]) as never;
  await week();
  fireEvent.click(await block(/Recorded sync/));
  const peek = await screen.findByRole('complementary', { name: 'Recorded sync' });
  await within(peek).findByRole('button', { name: /Present/ });
  expect(propValue(peek, 'Present')).toHaveTextContent('1 confirmed');
  const row = within(propRow(peek, 'Present'));
  expect(row.getByText('Ana')).toBeInTheDocument();
  expect(row.queryByText(/Bruno/)).toBeNull();
  expect(row.queryByText(/Invited only/)).toBeNull();
  cleanup();

  db.processing['m-rec'] = report([{ state: 'suggested', name: 'Bruno' }]) as never;
  await week();
  fireEvent.click(await block(/Recorded sync/));
  const again = await screen.findByRole('complementary', { name: 'Recorded sync' });
  expect(propValue(again, 'Present')).toHaveTextContent('Unknown');
  expect(
    await within(again).findByTitle('No speaker confirmed yet, so who came is unknown.')
  ).toBeInTheDocument();
  cleanup();

  // A meeting still to come has no such row at all.
  db.sessions = [];
  db.events = [
    event({ id: 'plain', title: 'Unrecorded', attendees: [{ name: 'Ana', email: null }] }),
  ];
  await week();
  fireEvent.click(await block(/Unrecorded/));
  const none = await screen.findByRole('complementary', { name: 'Unrecorded' });
  expect(within(none).queryByText('Present')).toBeNull();
});

it('styles blocks as Outlook does and names the state', async () => {
  db.events = [
    event({
      id: 'a',
      title: 'Said no',
      startsAt: at(1, 8),
      endsAt: at(1, 9),
      response: 'declined',
    }),
    event({ id: 'b', title: 'Maybe', startsAt: at(1, 10), endsAt: at(1, 11), showAs: 'tentative' }),
    event({ id: 'c', title: 'Open slot', startsAt: at(1, 12), endsAt: at(1, 13), showAs: 'free' }),
    event({ id: 'd', title: 'Normal', startsAt: at(1, 14), endsAt: at(1, 15), showAs: 'busy' }),
  ];
  await week();
  const said = await block(/Said no/);
  expect(said).toHaveAttribute('data-look', 'declined');
  expect(said.getAttribute('aria-label')).toContain('declined');
  expect((await block(/Maybe/)).getAttribute('data-look')).toBe('tentative');
  expect((await block(/Maybe/)).getAttribute('aria-label')).toContain('tentative');
  expect((await block(/Open slot/)).getAttribute('data-look')).toBe('free');
  expect((await block(/Open slot/)).getAttribute('aria-label')).toContain('free');
  expect((await block(/Normal/)).hasAttribute('data-look')).toBe(false);
});

const withSignals = () => {
  db.sessions = [
    session({ id: 'tall', title: 'Hour long', starts_at: at(-1, 9), ends_at: at(-1, 10) }),
    session({ id: 'short', title: 'Half hour', starts_at: at(-1, 11), ends_at: at(-1, 11, 30) }),
  ];
  const full = {
    transcript: true,
    speakers: { named: 2, unnamed: 1 },
    note: true,
    summary: true,
    generatedContent: true,
  };
  db.signals = {
    summariesOn: false,
    sessions: [signals('tall', full), signals('short', full)],
  };
};

it('shows icons on blocks with room, none on short ones, and names them on both', async () => {
  withSignals();
  await week();
  const tall = await block(/Hour long.*Transcribed/);
  expect(tall.querySelector('.ch-signals')).not.toBeNull();
  expect(within(tall).getByTitle('Transcribed')).toBeInTheDocument();
  expect(within(tall).getByTitle('Speakers: 2 named, 1 unnamed')).toBeInTheDocument();
  expect(within(tall).getByTitle('In memory: its summary')).toBeInTheDocument();

  const short = await block(/Half hour.*Transcribed/);
  expect(short.querySelector('.ch-signals')).toBeNull();
  expect(short.getAttribute('aria-label')).toContain('In memory: its summary');
});

it('marks a future meeting without preparation, and not a personal block', async () => {
  db.events = [
    event({
      id: 'next',
      title: 'Next meeting',
      startsAt: at(1, 9),
      endsAt: at(1, 10),
      attendees: [{ name: 'Ana', email: null }],
    }),
    event({ id: 'lunch', title: 'Lunch', startsAt: at(1, 12), endsAt: at(1, 13) }),
  ];
  await week();
  expect(await block(/Next meeting.*No preparation/)).toBeInTheDocument();
  expect((await block(/Lunch/)).getAttribute('aria-label')).not.toContain('No preparation');
});

it('shows the signals as rows in the peek', async () => {
  withSignals();
  await week();
  fireEvent.click(await block(/Hour long.*Transcribed/));
  const peek = await screen.findByRole('complementary', { name: 'Hour long' });
  expect(propValue(peek, 'Transcript')).toHaveTextContent('Yes');
  expect(propValue(peek, 'Speakers')).toHaveTextContent('3 · 2 named');
  expect(propValue(peek, 'Note')).toHaveTextContent('Yes');
  expect(propValue(peek, 'Memory')).toHaveTextContent('Yes · summary only');
});

it('lets the owner mark a past meeting, and take it back', async () => {
  withSignals();
  await week();
  fireEvent.click(await block(/Hour long.*Transcribed/));
  const peek = await screen.findByRole('complementary', { name: 'Hour long' });
  const useful = await within(peek).findByRole('button', { name: 'Useful' });
  expect(useful).toHaveAttribute('aria-pressed', 'false');
  // Generated content does not press anything by itself.
  expect(within(peek).getByRole('button', { name: 'Not useful' })).toHaveAttribute(
    'aria-pressed',
    'false'
  );

  fireEvent.click(useful);
  await waitFor(() => expect(useful).toHaveAttribute('aria-pressed', 'true'));
  expect(calledWith(db, 'library_set_meeting_mark')).toEqual([
    { sessionId: 'tall', mark: 'useful' },
  ]);
  expect(await within(propRow(peek, 'Rating')).findByText('Useful')).toBeInTheDocument();

  fireEvent.click(useful);
  await waitFor(() => expect(useful).toHaveAttribute('aria-pressed', 'false'));
  expect(calledWith(db, 'library_set_meeting_mark')[1]).toEqual({ sessionId: 'tall', mark: null });
  expect(within(propRow(peek, 'Rating')).queryByText('Useful')).toBeNull();
});

it('offers no mark on a future meeting', async () => {
  db.sessions = [session({ id: 'later', title: 'Later', starts_at: at(1, 9), ends_at: at(1, 10) })];
  db.signals = { summariesOn: false, sessions: [signals('later')] };
  await week();
  fireEvent.click(await block(/Later/));
  const peek = await screen.findByRole('complementary', { name: 'Later' });
  await within(peek).findByText('Preparation');
  expect(within(peek).queryByRole('button', { name: 'Useful' })).toBeNull();
});

it('says summaries are off and links to the setting, without implying memory', async () => {
  withSignals();
  db.signals = { summariesOn: false, sessions: [signals('tall', { transcript: true })] };
  const router = await week();
  fireEvent.click(await block(/Hour long/));
  const peek = await screen.findByRole('complementary', { name: 'Hour long' });
  expect(await within(peek).findByTitle('Not in memory: summaries are off.')).toHaveTextContent(
    'No'
  );
  expect(propValue(peek, 'Summary')).toHaveTextContent('Off');
  expect(peek.textContent).not.toMatch(/generated/i);
  fireEvent.click(
    within(peek).getByRole('button', { name: 'Set up summaries in Settings › Integrations' })
  );
  await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
  expect(router.state.location.hash).toBe('integrations');
});

it.each([
  [{ summary: true, transcript: true }, true, 'In memory: only its generated summary.', 'Yes'],
  [{ summary: true }, false, 'In memory: only its generated summary.', 'Yes'],
  [{ transcript: true }, true, 'Not in memory yet: its summary is still to be written.', 'Not yet'],
  [{}, true, 'Not in memory: there is no transcript to summarize.', 'No'],
])('states the memory of a past meeting honestly %#', async (o, summariesOn, text, value) => {
  withSignals();
  db.signals = { summariesOn, sessions: [signals('tall', o)] };
  await week();
  fireEvent.click(await block(/Hour long/));
  const peek = await screen.findByRole('complementary', { name: 'Hour long' });
  expect(await within(peek).findByTitle(text)).toBe(propValue(peek, 'Memory'));
  expect(propValue(peek, 'Memory')).toHaveTextContent(value);
  expect(within(peek).queryByRole('button', { name: /Set up summaries/ })).toBeNull();
});

it('shows the details and signals on the meeting page too', async () => {
  db.sessions = [
    session({ id: 'page', title: 'Roadmap sync', starts_at: at(1, 9), ends_at: at(1, 10) }),
  ];
  db.events = [detailed()];
  db.signals = { summariesOn: false, sessions: [signals('page', { note: true })] };
  renderAt('/meetings/page');
  const inspector = await screen.findByRole('complementary', { name: 'Meeting details' });
  expect(propValue(inspector, 'Response')).toHaveTextContent('Tentative');
  expect(within(inspector).getByText('Accepted (1)')).toBeInTheDocument();
  await waitFor(() => expect(propValue(inspector, 'Note')).toHaveTextContent('Yes'));
  // Join leads the column; the page's own header holds the primary action.
  const join = within(inspector).getByRole('button', { name: 'Join in Teams' });
  expect(join).toHaveAttribute('data-variant', 'secondary');
  expect(inspector.querySelector('button')).toBe(join);
  expect(inspector.querySelectorAll('.ch-person').length).toBeGreaterThan(0);
});

it('shows signals in the rows of the review list', async () => {
  db.sessions = [
    session({
      id: 'interrupted',
      title: 'Needs review',
      starts_at: at(-1, 9),
      ends_at: at(-1, 10),
      meeting_id: 'm-i',
      recording: recording('m-i', 'Needs review', 'finished'),
      transcript_status: 'none',
    }),
  ];
  db.signals = { summariesOn: false, sessions: [signals('interrupted', { note: true })] };
  renderAt('/meetings?review=true');
  const row = await screen.findByRole('button', { name: /Needs review.*Has a note/ });
  expect(within(row).getByTitle('Has a note')).toBeInTheDocument();
});
