import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Outlet } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import i18n from '../../lib/i18n';
import { useCaptureStore } from '../capture/captureStore';
import {
  at,
  backend,
  calledWith,
  event,
  freshDb,
  recording,
  renderAt,
  resetState,
  session,
  type Db,
} from './meetingsHub.harness';
import { requestMeetingsSheet } from './meetingsSheets';

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
  vi.mocked(openDialog).mockReset();
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await i18n.changeLanguage('en');
});

const grid = () => document.querySelector<HTMLElement>('.ch-main')!;
const rail = () => screen.getByRole('complementary', { name: 'Calendar navigation and filters' });
const findRail = () =>
  screen.findByRole('complementary', { name: 'Calendar navigation and filters' });
const findInGrid = async (name: RegExp) =>
  (await waitFor(() => within(grid()).getAllByRole('button', { name })))[0];
const inGrid = (name: RegExp) => within(grid()).queryAllByRole('button', { name });

it('shows the calendar first, each meeting once and no list beside it', async () => {
  renderAt('/meetings');
  await waitFor(() => expect(inGrid(/Roadmap review/)).toHaveLength(1));
  // The event claimed by the Roadmap session and the recording owned by Rita's session appear once.
  expect(inGrid(/1:1 with Rita/)).toHaveLength(1);
  expect(inGrid(/Product committee/)).toHaveLength(1);
  expect(screen.queryByRole('tab', { name: 'Upcoming and recent' })).toBeNull();
  expect(
    screen.getByRole('heading', { level: 2, name: /October 12.*18, 2026/ })
  ).toBeInTheDocument();
  // Never starts an Outlook authorization just by opening the screen.
  expect(calledWith(db, 'calendar_begin')).toHaveLength(0);
});

it('lists interrupted, failed and untranscribed meetings in the review sheet', async () => {
  const router = renderAt('/meetings');
  const button = await within(await findRail()).findByRole('button', { name: /To review/ });
  await waitFor(() => expect(button).toHaveAccessibleName(/2 meetings to review/));
  fireEvent.click(button);
  const sheet = await screen.findByRole('dialog', { name: 'To review' });
  const titles = [...sheet.querySelectorAll('[data-row-title]')].map((el) => el.textContent);
  expect(titles).toEqual(['Squad daily', 'Backend interview']);
  expect(within(sheet).getByRole('button', { name: /Backend interview/ })).toHaveTextContent(
    'interrupted'
  );
  fireEvent.click(within(sheet).getByRole('button', { name: /Backend interview/ }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/meetings/interview'));
});

it('opens the review sheet from the old review tab URL', async () => {
  const router = renderAt('/meetings?tab=review');
  expect(await screen.findByRole('dialog', { name: 'To review' })).toBeInTheDocument();
  await waitFor(() => expect(router.state.location.search).not.toHaveProperty('review'));
});

it('jumps to any day from the rail and keeps the date when a meeting is opened', async () => {
  const router = renderAt('/meetings');
  await waitFor(() => expect(inGrid(/Product committee/)).toHaveLength(1));
  fireEvent.click(within(rail()).getByRole('button', { name: /October 21/ }));
  expect(
    await screen.findByRole('heading', { level: 2, name: /October 19.*25, 2026/ })
  ).toBeInTheDocument();
  fireEvent.click(within(rail()).getByRole('button', { name: /October 7/ }));
  await screen.findByRole('heading', { level: 2, name: /October 5.*11, 2026/ });
  const interview = await findInGrid(/Backend interview/);
  fireEvent.doubleClick(interview);
  await waitFor(() => expect(router.state.location.pathname).toBe('/meetings/interview'));
  fireEvent.click(await screen.findByRole('button', { name: 'Calendar' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/meetings'));
  expect(
    await screen.findByRole('heading', { level: 2, name: /October 5.*11, 2026/ })
  ).toBeInTheDocument();
});

it('maps the old calendar path to the month view', async () => {
  const router = renderAt('/calendar');
  await waitFor(() => expect(router.state.location.pathname).toBe('/meetings'));
  expect(router.state.location.search).toMatchObject({ view: 'month' });
  expect(await screen.findByRole('button', { name: 'Month', pressed: true })).toBeInTheDocument();
  expect(await within(grid()).findByRole('table')).toBeInTheDocument();
});

it('shows now and next above the calendar, with LiveBadge only for a live capture', async () => {
  db.events.push(
    event({ id: 'e-now', title: 'Steering', startsAt: at(0, 11, 30), endsAt: at(0, 12, 30) }),
    event({ id: 'e-soon', title: 'Vendor call', startsAt: at(0, 12, 25), endsAt: at(0, 13) })
  );
  renderAt('/meetings');
  const strip = await screen.findByRole('region', { name: 'Now and next' });
  await waitFor(() => expect(strip).toHaveTextContent('Steering'));
  expect(strip).toHaveTextContent('In 25 min');
  expect(strip).toHaveTextContent('Vendor call');
  // A persisted capture state "recording" is not live: no REC anywhere.
  expect(document.querySelector('.cx-live-badge')).toBeNull();
  act(() =>
    useCaptureStore.setState({
      status: {
        active: {
          meetingId: 'm-daily',
          paused: false,
          elapsedMs: 5000,
          mic: { peak: 0, lastBlockMs: null, error: null },
          output: { peak: 0, lastBlockMs: null, error: null },
        },
        error: null,
      },
    })
  );
  await waitFor(() => expect(strip).toHaveTextContent('Squad daily'));
  expect(strip.querySelector('.cx-live-badge')).not.toBeNull();

  fireEvent.click(within(strip).getByRole('button', { name: 'Prepare Vendor call' }));
  await waitFor(() =>
    expect(calledWith(db, 'library_create_session')[0].input).toMatchObject({
      title: 'Vendor call',
    })
  );
});

it('offers Outlook connection when no account is connected, without authorizing', async () => {
  db.account = null;
  db.events = [];
  renderAt('/meetings');
  fireEvent.click(await within(await findRail()).findByRole('button', { name: 'Connect Outlook' }));
  const sheet = await screen.findByRole('dialog', { name: 'Outlook' });
  expect(within(sheet).getByRole('button', { name: /Connect Outlook/ })).toBeInTheDocument();
  expect(calledWith(db, 'calendar_begin')).toHaveLength(0);
});

it('shows a load error with retry and recovers the calendar', async () => {
  db.failSessions = 1;
  renderAt('/meetings');
  expect(await screen.findByText('Could not load meetings.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(inGrid(/Squad daily/)).toHaveLength(1));
  expect(screen.queryByText('Could not load meetings.')).toBeNull();
});

it('imports one WAV through the native dialog and opens the new recording', async () => {
  vi.mocked(openDialog).mockResolvedValue('/home/me/backend-interview.wav');
  const router = renderAt('/meetings');
  fireEvent.click(await screen.findByRole('button', { name: 'Import audio' }));
  const sheet = await screen.findByRole('dialog', { name: 'Import audio' });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Choose WAV file…' }));
  await waitFor(() =>
    expect(within(sheet).getByRole('textbox', { name: 'Title' })).toHaveValue('backend-interview')
  );
  expect(openDialog).toHaveBeenCalledWith(
    expect.objectContaining({
      multiple: false,
      directory: false,
      filters: [{ name: 'WAV', extensions: ['wav'] }],
    })
  );
  fireEvent.click(within(sheet).getByRole('button', { name: 'Import' }));
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({ recording: 'm-imported' })
  );
  expect(calledWith(db, 'library_import_audio')).toEqual([
    { title: 'backend-interview', path: '/home/me/backend-interview.wav' },
  ]);
  expect(
    await screen.findByRole('heading', { level: 2, name: 'backend-interview' })
  ).toBeInTheDocument();
});

it('shows an import failure and lets the user try again', async () => {
  db.failImport = true;
  vi.mocked(openDialog).mockResolvedValue('/tmp/broken.wav');
  renderAt('/meetings');
  fireEvent.click(await screen.findByRole('button', { name: 'Import audio' }));
  const sheet = await screen.findByRole('dialog', { name: 'Import audio' });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Choose WAV file…' }));
  await waitFor(() => expect(within(sheet).getByRole('button', { name: 'Import' })).toBeEnabled());
  fireEvent.click(within(sheet).getByRole('button', { name: 'Import' }));
  expect(await within(sheet).findByText(/not a WAV file/)).toBeInTheDocument();
  expect(within(sheet).getByRole('button', { name: 'Import' })).toBeEnabled();
});

it('creates a planned session from the new meeting sheet and opens it', async () => {
  const router = renderAt('/meetings');
  fireEvent.click(await screen.findByRole('button', { name: 'New meeting' }));
  const sheet = await screen.findByRole('dialog', { name: 'New meeting' });
  fireEvent.change(within(sheet).getByRole('textbox', { name: 'Title' }), {
    target: { value: 'Security alignment' },
  });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Create meeting' }));
  await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/meetings\/s-new-/));
  const [created] = calledWith(db, 'library_create_session');
  expect(created.input).toMatchObject({ title: 'Security alignment', status: 'planned' });
  expect(String((created.input as { starts_at: string }).starts_at)).toMatch(/Z$/);
  expect(calledWith(db, 'library_start_session')).toHaveLength(0);
  expect(
    await screen.findByRole('heading', { level: 2, name: 'Security alignment' })
  ).toBeInTheDocument();
});

it('opens the new meeting sheet from the palette event while mounted', async () => {
  renderAt('/meetings');
  await screen.findByRole('button', { name: 'New meeting' });
  act(() => {
    window.dispatchEvent(new Event('coxinha:new-meeting'));
  });
  expect(await screen.findByRole('dialog', { name: 'New meeting' })).toBeInTheDocument();
});

it('opens the import sheet requested before the screen mounted', async () => {
  requestMeetingsSheet('import');
  renderAt('/meetings');
  expect(await screen.findByRole('dialog', { name: 'Import audio' })).toBeInTheDocument();
});

it('speaks Portuguese', async () => {
  await i18n.changeLanguage('pt-BR');
  renderAt('/meetings');
  expect(await screen.findByRole('heading', { level: 1, name: 'Reuniões' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Nova reunião' })).toBeInTheDocument();
  expect(
    screen.getByRole('searchbox', { name: 'Buscar em reuniões, notas e transcrições' })
  ).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: /A revisar/ })).toBeInTheDocument();
});

function chromeRecording() {
  const committee = event({
    id: 'e-committee',
    title: 'IT committee',
    startsAt: at(-2, 9),
    endsAt: at(-2, 11),
    attendees: [{ name: 'Ana', email: 'ana@example.com' }],
  });
  const standup = event({
    id: 'e-standup',
    title: 'Standup',
    startsAt: at(-2, 9, 15),
    endsAt: at(-2, 9, 30),
  });
  const lunch = event({ id: 'e-lunch', title: 'Lunch', startsAt: at(-2, 12), endsAt: at(-2, 13) });
  db.events = [...db.events, committee, standup, lunch];
  db.sessions = [
    ...db.sessions,
    session({
      id: 's-chrome',
      title: 'Meeting in Google Chrome',
      status: 'completed',
      meeting_id: 'm-chrome',
      recording: recording('m-chrome', 'Meeting in Google Chrome', 'finished', at(-2, 9, 19)),
    }),
  ];
  db.calendarMatches = [
    {
      sessionId: 's-chrome',
      meetingId: 'm-chrome',
      title: 'Meeting in Google Chrome',
      startsAt: at(-2, 9, 19),
      endsAt: at(-2, 9, 29),
      event: committee,
    },
  ];
}

it('asks in the peek which calendar meeting a recording is, and links the one picked', async () => {
  chromeRecording();
  renderAt('/meetings');
  fireEvent.click(
    await within(await findRail()).findByRole('button', {
      name: /1 recording looks like a meeting on your calendar/,
    })
  );
  const peek = await screen.findByRole('complementary', { name: 'Meeting in Google Chrome' });
  const question = within(peek).getByRole('radiogroup', { name: 'Is this the meeting?' });
  const options = within(question).getAllByRole('radio');
  expect(options.map((o) => o.closest('label')!.textContent)).toEqual([
    expect.stringMatching(/IT committee.*1 invitee · likely/),
    expect.stringMatching(/Standup/),
  ]);
  expect(options[0]).toBeChecked();
  // The calendar keeps only the recording and the checked event in colour.
  const block = (key: string) => grid().querySelector(`[data-key="${key}"]`)!;
  expect(block('s:s-chrome')).toHaveAttribute('data-selected');
  expect(block('e:e-committee')).toHaveAttribute('data-candidate');
  expect(block('e:e-lunch')).toHaveAttribute('data-dimmed');
  fireEvent.click(options[1]);
  expect(block('e:e-standup')).toHaveAttribute('data-candidate');
  expect(block('e:e-committee')).toHaveAttribute('data-dimmed');
  fireEvent.click(within(peek).getByRole('button', { name: 'Same meeting' }));
  await waitFor(() =>
    expect(calledWith(db, 'library_resolve_calendar_match')).toEqual([
      { sessionId: 's-chrome', eventId: 'e-standup', accept: true },
    ])
  );
  await waitFor(() =>
    expect(within(rail()).queryByRole('button', { name: /looks like a meeting/ })).toBeNull()
  );
});

it('remembers "none of these" for the proposed event', async () => {
  chromeRecording();
  renderAt('/meetings');
  fireEvent.click(
    await within(await findRail()).findByRole('button', { name: /looks like a meeting/ })
  );
  const peek = await screen.findByRole('complementary', { name: 'Meeting in Google Chrome' });
  fireEvent.click(within(peek).getByRole('button', { name: 'None of these' }));
  await waitFor(() =>
    expect(calledWith(db, 'library_resolve_calendar_match')).toEqual([
      { sessionId: 's-chrome', eventId: 'e-committee', accept: false },
    ])
  );
  expect(
    await within(peek).findByRole('button', { name: 'Link to a calendar meeting' })
  ).toBeInTheDocument();
  expect(grid().querySelector('[data-dimmed]')).toBeNull();
});
