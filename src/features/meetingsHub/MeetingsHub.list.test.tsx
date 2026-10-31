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
  await i18n.changeLanguage('en');
});

const list = () => screen.getByRole('region', { name: 'Meetings' });
const rowTitles = () =>
  [...list().querySelectorAll('[data-row-title]')].map((el) => el.textContent);

it('merges sessions, unclaimed Outlook events and loose recordings into dated groups', async () => {
  renderAt('/meetings');
  await waitFor(() => expect(rowTitles()).toContain('Product committee'));
  const titles = rowTitles();
  // The event claimed by the Roadmap session and the recording owned by Rita's session appear once.
  expect(titles.filter((t) => t === 'Roadmap review')).toHaveLength(1);
  expect(titles.filter((t) => t === '1:1 with Rita')).toHaveLength(1);
  expect(titles).toContain('Imported interview');
  expect(titles).toContain('Undated manual meeting');
  const groups = within(list())
    .getAllByRole('heading', { level: 2 })
    .map((h) => h.textContent);
  expect(groups).toEqual(['Next days', 'Earlier']);
  expect(within(list()).getByRole('button', { name: /Product committee/ })).toHaveTextContent(
    'Outlook · 1 person'
  );
  expect(within(list()).getByRole('button', { name: /Imported interview/ })).toHaveTextContent(
    'standalone recording'
  );
  // Never starts an Outlook authorization just by opening the screen.
  expect(calledWith(db, 'calendar_begin')).toHaveLength(0);
});

it('filters the A revisar tab to interrupted, failed and untranscribed meetings', async () => {
  renderAt('/meetings');
  const reviewTab = await screen.findByRole('tab', { name: /To review/ });
  await waitFor(() => expect(reviewTab).toHaveTextContent('2'));
  fireEvent.click(reviewTab);
  await waitFor(() => expect(rowTitles()).toEqual(['Squad daily', 'Backend interview']));
  expect(screen.getByRole('heading', { name: 'Waiting for you' })).toBeInTheDocument();
  expect(within(list()).getByRole('button', { name: /Backend interview/ })).toHaveTextContent(
    'interrupted'
  );
});

it('searches by title and invitee', async () => {
  renderAt('/meetings');
  await waitFor(() => expect(rowTitles()).toContain('Product committee'));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search title or person' }), {
    target: { value: 'juliana' },
  });
  expect(rowTitles()).toEqual(['Product committee']);
});

it('opens the month tab from the old calendar path and opens a meeting from a day', async () => {
  const router = renderAt('/calendar');
  await waitFor(() => expect(router.state.location.pathname).toBe('/meetings'));
  expect(router.state.location.search).toMatchObject({ tab: 'month' });
  expect(await screen.findByRole('tab', { name: 'Month', selected: true })).toBeInTheDocument();
  const grid = await screen.findByRole('table');
  const daily = await within(grid).findByRole('button', { name: /Squad daily/ });
  fireEvent.click(daily);
  await waitFor(() => expect(router.state.location.pathname).toBe('/meetings/daily'));
  expect(
    screen.getByRole('tab', { name: 'Upcoming and recent', selected: true })
  ).toBeInTheDocument();
  expect(await screen.findByRole('heading', { level: 2, name: 'Squad daily' })).toBeInTheDocument();
});

it('marks only a live capture with LiveBadge, never a persisted recording state', async () => {
  renderAt('/meetings');
  await waitFor(() => expect(rowTitles()).toContain('Backend interview'));
  // Persisted capture_state "recording" without a live capture: no REC, needs recovery.
  expect(within(list()).queryByText('REC')).toBeNull();
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
  const live = await within(list()).findByRole('button', { name: /Squad daily/ });
  expect(live.querySelector('.cx-live-badge')).not.toBeNull();
  expect(within(list()).getByRole('heading', { name: 'Now' })).toBeInTheDocument();
  expect(
    within(list())
      .getByRole('button', { name: /Backend interview/ })
      .querySelector('.cx-live-badge')
  ).toBeNull();
});

it('offers Outlook connection when no account is connected, without authorizing', async () => {
  db.account = null;
  db.events = [];
  renderAt('/meetings');
  fireEvent.click(await screen.findByRole('button', { name: 'Connect Outlook' }));
  const sheet = await screen.findByRole('dialog', { name: 'Outlook' });
  expect(within(sheet).getByRole('button', { name: /Connect Outlook/ })).toBeInTheDocument();
  expect(calledWith(db, 'calendar_begin')).toHaveLength(0);
});

it('shows a load error with retry and recovers the list', async () => {
  db.failSessions = 1;
  renderAt('/meetings');
  expect(await screen.findByText('Could not load meetings.')).toBeInTheDocument();
  fireEvent.click(within(list()).getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(rowTitles()).toContain('Squad daily'));
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
  fireEvent.click(await screen.findByRole('button', { name: 'New' }));
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
  await screen.findByRole('region', { name: 'Meetings' });
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
  expect(screen.getByRole('tab', { name: 'Próximas e recentes' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Anteriores' })).toBeInTheDocument();
});
