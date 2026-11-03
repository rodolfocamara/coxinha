import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Outlet } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
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
  NoteEditor: ({ content }: { content: { markdown: string } }) => (
    <div role="textbox" aria-label="Meeting notes">
      {content.markdown}
    </div>
  ),
  NoteLoadingSkeleton: () => <p>Loading editor</p>,
}));
vi.mock('../meetings/ProcessingPanel', () => ({
  ProcessingPanel: ({ meetingId, view }: { meetingId: string; view?: string }) => (
    <p>
      Pipeline {meetingId} {view}
    </p>
  ),
}));

let db: Db;
beforeEach(async () => {
  // Mid-month: fixtures sit days around "now" and must share the month grid.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 15, 12));
  resetState();
  await i18n.changeLanguage('en');
  db = freshDb();
  db.account = 'me@example.com';
  db.sessions = [
    session({
      id: 'rita',
      title: '1:1 with Rita',
      starts_at: at(-3, 16),
      ends_at: at(-3, 16, 32),
      status: 'completed',
      meeting_id: 'm-rita',
      recording: recording('m-rita', '1:1 with Rita'),
      transcript_status: 'available',
      processing_state: 'succeeded',
    }),
    session({
      id: 'daily',
      title: 'Squad daily',
      starts_at: at(-3, 9, 30),
      ends_at: at(-3, 9, 44),
      meeting_id: 'm-daily',
      recording: recording('m-daily', 'Squad daily'),
      personal_note: { id: 'n1', relative_path: 'notes/session-n1.md' },
    }),
    session({
      id: 'interview',
      title: 'Backend interview',
      starts_at: at(-4, 15),
      meeting_id: 'm-int',
      recording: recording('m-int', 'Backend interview', 'recording'),
    }),
    session({ id: 'roadmap', title: 'Roadmap review', starts_at: at(3, 9), ends_at: at(3, 10) }),
    session({ id: 'undated', title: 'Undated manual meeting' }),
  ];
  db.events = [
    event({
      id: 'e-roadmap',
      title: 'Roadmap review',
      startsAt: at(3, 9),
      endsAt: at(3, 10),
      attendees: [{ name: 'Ana', email: 'ana@example.com' }],
    }),
    event({
      id: 'e-committee',
      title: 'Product committee',
      startsAt: at(2, 14),
      endsAt: at(2, 15),
      attendees: [{ name: 'Juliana Alves', email: 'ju@example.com' }],
    }),
  ];
  db.recordings = [
    recording('m-rita', '1:1 with Rita'),
    recording('m-loose', 'Imported interview', 'finished', at(-5, 10)),
  ];
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(backend(db));
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await i18n.changeLanguage('en');
});

const grid = () => document.querySelector<HTMLElement>('.ch-main')!;
const findInGrid = async (name: RegExp) =>
  (await waitFor(() => within(grid()).getAllByRole('button', { name })))[0];
const inGrid = (name: RegExp) => within(grid()).queryAllByRole('button', { name });
const peek = () => document.querySelector<HTMLElement>('.ch-peek');

it('searches through the universal palette, not a list of its own (spec 0122)', async () => {
  const opened = vi.fn();
  window.addEventListener('coxinha:open-palette', opened);
  try {
    renderAt('/meetings');
    await waitFor(() => expect(inGrid(/Product committee/)).toHaveLength(1));
    expect(screen.queryByRole('searchbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Search everything' }));
    expect(opened).toHaveBeenCalledTimes(1);
    expect(inGrid(/Product committee/)).toHaveLength(1);
  } finally {
    window.removeEventListener('coxinha:open-palette', opened);
  }
});

it('peeks on click, closes on Escape, and opens the page on double click or Enter', async () => {
  db.summaries['m-rita'] = { markdown: '## Decisions\n- Ship the **beta**', generatedAt: 'now' };
  db.processing['m-rita'] = {
    jobs: [],
    people: [],
    report: {
      job: 'j1',
      turns: [],
      warnings: [],
      corrections: { b: 'we ship the beta on Friday' },
      assignments: [
        {
          id: 'a',
          speaker: 'S1',
          track: 'output',
          person_id: 'p',
          state: 'confirmed',
          name: 'Rita',
        },
      ],
      segments: [
        { id: 'a', track: 'mic', start_ms: 1000, end_ms: 2000, text: 'hello', speaker: null },
        { id: 'b', track: 'output', start_ms: 65000, end_ms: 70000, text: 'x', speaker: 'S1' },
      ],
    },
  };
  const router = renderAt('/meetings?view=month');
  const rita = await findInGrid(/1:1 with Rita/);
  fireEvent.click(rita);
  const card = await screen.findByRole('complementary', { name: '1:1 with Rita' });
  expect(rita).toHaveAttribute('aria-expanded', 'true');
  expect(await within(card).findByText('• Ship the beta')).toBeInTheDocument();
  expect(within(card).getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
  expect(
    await within(card).findByText('[01:05] Rita: we ship the beta on Friday')
  ).toBeInTheDocument();
  expect(document.activeElement).toBe(within(card).getByRole('heading', { level: 2 }));

  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(peek()).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(inGrid(/1:1 with Rita/)[0]));

  // Without a summary, the start of the meeting's notes.
  fireEvent.click(inGrid(/Squad daily/)[0]);
  const daily = await screen.findByRole('complementary', { name: 'Squad daily' });
  expect(await within(daily).findByText('Agenda text')).toBeInTheDocument();
  expect(within(daily).getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
  fireEvent.click(within(daily).getByRole('button', { name: 'Open meeting' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/meetings/daily'));
  fireEvent.click(await screen.findByRole('button', { name: 'Calendar' }));

  const again = await findInGrid(/1:1 with Rita/);
  fireEvent.keyDown(again, { key: 'Enter' });
  await waitFor(() => expect(router.state.location.pathname).toBe('/meetings/rita'));
  expect(router.state.location.search).toMatchObject({ view: 'month' });
});

it('opens the transcript tab from the peek', async () => {
  db.processing['m-rita'] = {
    jobs: [],
    people: [],
    report: {
      job: 'j1',
      turns: [],
      warnings: [],
      corrections: {},
      assignments: [],
      segments: [{ id: 'a', track: 'mic', start_ms: 0, end_ms: 1, text: 'hello', speaker: null }],
    },
  };
  const router = renderAt('/meetings');
  fireEvent.click(await findInGrid(/1:1 with Rita/));
  const card = await screen.findByRole('complementary', { name: '1:1 with Rita' });
  fireEvent.click(await within(card).findByRole('button', { name: /full transcript/ }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/meetings/rita'));
  expect(router.state.location.search).toMatchObject({ panel: 'transcript' });
  expect(
    await screen.findByRole('tab', { name: 'Transcript', selected: true })
  ).toBeInTheDocument();
});
