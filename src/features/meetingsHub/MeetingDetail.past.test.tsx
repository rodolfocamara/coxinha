import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Outlet } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import {
  before,
  invited,
  openPeek as open,
  primaries,
  recorded,
  signals,
  speakers,
  team,
} from './meetingDetail.harness';
import {
  at,
  backend,
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

it('leads a past meeting with its result, then people, the mark and the event', async () => {
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

  const result = within(panel).getByRole('heading', { name: 'Result' });
  const summary = await within(panel).findByRole('heading', { name: 'Summary' });
  const people = within(panel).getByRole('heading', { name: 'People' });
  await within(panel).findByRole('button', { name: 'Useful' });
  await within(panel).findByRole('button', { name: /Present/ });
  before(result, summary);
  before(summary, people);
  before(people, propRow(panel, 'Present'));
  before(propRow(panel, 'Present'), propRow(panel, 'Invited'));
  before(propRow(panel, 'Invited'), propRow(panel, 'Rating'));
  before(propRow(panel, 'Rating'), propRow(panel, 'Location'));
  expect(propValue(panel, 'Location')).toHaveTextContent('Room 4');
  expect(panel.querySelector('[data-outcome]')).toContainElement(propRow(panel, 'Memory'));
  expect(within(panel).getByText('Ship it', { exact: false })).toBeVisible();

  // Who came and who was invited stay apart; a confirmed invitee is marked.
  expect(propValue(panel, 'Present')).toHaveTextContent('2 confirmed');
  const rows = [...panel.querySelectorAll<HTMLElement>('.ch-person')];
  const bruno = rows.filter((row) => row.textContent?.includes('Bruno Dias'));
  expect(bruno).toHaveLength(2);
  expect(within(bruno[1]).getByText('Confirmed on the recording')).toBeInTheDocument();
  const ana = rows.find((row) => row.textContent?.includes('Ana Lima'))!;
  expect(within(ana).queryByText('Confirmed on the recording')).toBeNull();
  expect(rows.filter((row) => row.textContent?.includes('Outside Guest'))).toHaveLength(1);

  // The invitation is out of the way, and its control says so.
  const toggle = within(panel).getByRole('button', { name: /Invitation/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(within(panel).getByText('Bring the numbers.')).not.toBeVisible();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(within(panel).getByText('Bring the numbers.')).toBeVisible();
});

it('leaves a Teams placeholder out of a past meeting', async () => {
  db.events = [
    invited(team, {
      id: 'e',
      title: 'Over',
      startsAt: at(-1, 9),
      endsAt: at(-1, 10),
      location: 'Reuniões do Microsoft Teams',
    }),
  ];
  const panel = await open(/Over/, 'Over');
  expect(within(panel).queryByText('Location')).toBeNull();
});

it('shows a past meeting that produced nothing as dashes, not as a sentence', async () => {
  db.sessions = [
    session({ id: 'x', title: 'Empty one', starts_at: at(-1, 9), ends_at: at(-1, 10) }),
  ];
  db.signals = { summariesOn: true, sessions: [signals('x')] };
  const panel = await open(/Empty one/, 'Empty one');
  await within(panel).findByRole('button', { name: 'Useful' });
  expect(propValue(panel, 'Transcript')).toHaveTextContent(/^No$/);
  for (const label of ['Speakers', 'Note', 'Summary', 'Follow-ups', 'Files'])
    expect(propValue(panel, label).querySelector('[aria-hidden]')).toHaveTextContent('—');
  expect(panel.querySelector('[data-outcome]')).not.toBeNull();
  expect(panel.querySelector('[data-titled]')).toBeNull();
  // Nothing to open, name or set up.
  expect(
    within(panel).queryByRole('button', { name: /transcript|speakers|summaries/i })
  ).toBeNull();
});

it('counts the files of a past meeting, and opens them from the row', async () => {
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
  const toggle = await within(panel).findByRole('button', { name: /Files/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(propValue(panel, 'Files')).toHaveTextContent('1');
  fireEvent.click(toggle);
  expect(within(panel).getByRole('button', { name: 'plan.pdf' })).toBeVisible();
});

it('never shows a transcript excerpt or a track id, and links to the full transcript', async () => {
  db.sessions = [recorded()];
  db.processing['m-rec'] = {
    jobs: [],
    people: [],
    report: {
      job: 'j',
      turns: [],
      warnings: [],
      corrections: {},
      assignments: [],
      segments: [
        {
          id: 'a',
          track: 'output',
          start_ms: 0,
          end_ms: 1,
          text: 'raw words',
          speaker: 'speaker-3',
        },
      ],
    },
  } as never;
  const panel = await open(/Recorded sync/, 'Recorded sync');
  const link = await within(panel).findByRole('button', { name: 'Open the full transcript' });
  expect(propRow(panel, 'Transcript')).toContainElement(link);
  expect(propValue(panel, 'Transcript')).toHaveTextContent('Yes');
  expect(panel.textContent).not.toMatch(/raw words|output|speaker-3/);
});

it('says a transcript is on its way or failed, instead of "no"', async () => {
  db.sessions = [recorded()];
  const job = { id: 'j', state: 'running', attempts: 1, error: null };
  db.processing['m-rec'] = { jobs: [job], people: [], report: null } as never;
  const panel = await open(/Recorded sync/, 'Recorded sync');
  await waitFor(() => expect(propValue(panel, 'Transcript')).toHaveTextContent('In progress'));
  cleanup();
  db.processing['m-rec'] = {
    jobs: [{ ...job, state: 'failed' }],
    people: [],
    report: null,
  } as never;
  const again = await open(/Recorded sync/, 'Recorded sync');
  await waitFor(() => expect(propValue(again, 'Transcript')).toHaveTextContent('Failed'));
});

it('opens speaker naming from the row, only while someone is unnamed', async () => {
  db.sessions = [recorded()];
  db.signals = {
    summariesOn: false,
    sessions: [signals('rec', { transcript: true, speakers: { named: 0, unnamed: 6 } })],
  };
  const panel = await open(/Recorded sync/, 'Recorded sync');
  await waitFor(() => expect(propValue(panel, 'Speakers')).toHaveTextContent('6 · none named'));
  fireEvent.click(within(panel).getByRole('button', { name: 'Name the speakers' }));
  expect(await screen.findByRole('tab', { name: /Speakers/, selected: true })).toBeInTheDocument();
  cleanup();
  db.signals = {
    summariesOn: false,
    sessions: [signals('rec', { transcript: true, speakers: { named: 2, unnamed: 0 } })],
  };
  const named = await open(/Recorded sync/, 'Recorded sync');
  await waitFor(() => expect(propValue(named, 'Speakers')).toHaveTextContent('2 · all named'));
  expect(within(named).queryByRole('button', { name: 'Name the speakers' })).toBeNull();
});

it.each([
  [{ summary: true, transcript: true }, true, 'Yes'],
  [{ transcript: true }, true, 'Not yet'],
  [{}, true, ''],
  [{ transcript: true }, false, 'Off'],
])('states the summary of a past meeting on its row %#', async (o, summariesOn, text) => {
  db.sessions = [recorded()];
  db.signals = { summariesOn, sessions: [signals('rec', o)] };
  const panel = await open(/Recorded sync/, 'Recorded sync');
  await within(panel).findByRole('button', { name: 'Useful' });
  const row = propValue(panel, 'Summary');
  if (text) expect(row).toHaveTextContent(text);
  else expect(row.querySelector('[aria-hidden]')).toHaveTextContent('—');
  const action = within(panel).queryByRole('button', { name: /Set up summaries/ });
  expect(!!action).toBe(text === 'Off');
});

it('gives every body line a row or a title', async () => {
  db.sessions = [recorded()];
  db.events = [
    invited(team, { id: 'e', title: 'Recorded sync', startsAt: at(-1, 9), endsAt: at(-1, 10) }),
  ];
  db.summaries['m-rec'] = { markdown: '- Ship it', generatedAt: 'now' };
  const panel = await open(/Recorded sync/, 'Recorded sync');
  await within(panel).findByRole('heading', { name: 'Summary' });
  const body = panel.querySelector('.ch-peek-body')!;
  for (const child of body.children)
    expect(child.matches('.ch-prop-group, [data-titled]')).toBe(true);
  for (const row of body.querySelectorAll('.ch-prop')) {
    expect(row.querySelector(':scope > dt')?.textContent?.trim()).toBeTruthy();
    expect(row.querySelector(':scope > dd')).not.toBeNull();
  }
});
