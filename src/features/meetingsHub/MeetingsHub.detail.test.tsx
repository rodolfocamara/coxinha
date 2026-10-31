import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Outlet } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { useCaptureStore } from '../capture/captureStore';
import { rememberProcessingConfig } from '../meetings/processingConfigMemory';
import type { ProcessingReport } from '../meetings/library';
import {
  at,
  backend,
  calledWith,
  event,
  freshDb,
  fromNow,
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
    <div>
      <p>
        Pipeline {meetingId} {view}
      </p>
      <input type="file" data-processing-config aria-label="Model configuration" />
    </div>
  ),
}));

const report: ProcessingReport = {
  job: 'j1',
  turns: [
    { id: '1', track: 'mic', speaker: 'S0', start_ms: 0, end_ms: 240_000 },
    { id: '2', track: 'output', speaker: 'S1', start_ms: 240_000, end_ms: 480_000 },
  ],
  segments: [],
  warnings: [],
  corrections: {},
  assignments: [
    {
      id: 'a',
      speaker: 'S0',
      track: 'mic',
      person_id: 'p',
      state: 'confirmed',
      name: 'Rodolfo Camara',
    },
  ],
};

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
      meeting_id: 'm-rita',
      recording: recording('m-rita', 'Original recording title'),
      transcript_status: 'available',
      processing_state: 'succeeded',
    }),
    session({
      id: 'daily',
      title: 'Squad daily',
      starts_at: at(-3, 9),
      meeting_id: 'm-daily',
      recording: recording('m-daily', 'Squad daily'),
    }),
    session({
      id: 'failed',
      title: 'Interview',
      starts_at: at(-4, 15),
      meeting_id: 'm-failed',
      recording: recording('m-failed', 'Interview'),
      processing_state: 'failed',
    }),
    session({
      id: 'broken',
      title: 'Crashed weekly',
      starts_at: at(-1, 10),
      meeting_id: 'm-broken',
      recording: recording('m-broken', 'Crashed weekly', 'interrupted'),
    }),
    session({ id: 'planned', title: 'Committee', starts_at: fromNow(120), ends_at: fromNow(180) }),
  ];
  db.processing = {
    'm-rita': {
      jobs: [{ id: 'j1', state: 'succeeded', attempts: 1, error: null }],
      report,
      people: [],
    },
    'm-failed': {
      jobs: [{ id: 'j9', state: 'failed', attempts: 1, error: 'model file changed' }],
      report: null,
      people: [],
    },
  };
  db.events = [
    event({
      id: 'e-planning',
      title: 'Q4 planning',
      startsAt: fromNow(60),
      endsAt: fromNow(120),
      attendees: [
        { name: 'Rita Souza', email: 'rita@example.com' },
        { name: 'Marcos Lima', email: 'marcos@example.com' },
      ],
    }),
  ];
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(backend(db));
});
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});

const detail = () => screen.getByRole('article');
const tab = (name: string | RegExp) => within(detail()).getByRole('tab', { name });

it('shows notes, transcript and speakers tabs with keyboard navigation and lanes from turns', async () => {
  renderAt('/meetings/rita');
  expect(
    await screen.findByRole('heading', { level: 2, name: '1:1 with Rita' })
  ).toBeInTheDocument();
  expect(await within(detail()).findByRole('textbox', { name: 'Meeting notes' })).toHaveTextContent(
    'Agenda text'
  );
  const lanes = await within(detail()).findByRole('group', { name: 'Speaker lanes' });
  expect(lanes).toHaveTextContent('Rodolfo Camara');
  expect(lanes).toHaveTextContent('Speaker 2');
  expect(lanes).toHaveTextContent('50%');
  // One speaker waits for confirmation: banner and Speakers badge.
  expect(within(detail()).getByText('1 speaker without a confirmed name.')).toBeInTheDocument();
  expect(tab(/Speakers/)).toHaveTextContent('1');
  tab('Notes').focus();
  fireEvent.keyDown(tab('Notes'), { key: 'ArrowRight' });
  expect(tab('Transcript')).toHaveAttribute('aria-selected', 'true');
  expect(tab('Transcript')).toHaveFocus();
  // The transcript is the original recording's pipeline, not the session title.
  expect(await within(detail()).findByText(/Pipeline m-rita transcript/)).toBeInTheDocument();
  fireEvent.keyDown(tab('Transcript'), { key: 'End' });
  expect(tab(/Speakers/)).toHaveAttribute('aria-selected', 'true');
  expect(await within(detail()).findByText(/Pipeline m-rita people/)).toBeInTheDocument();
  expect(within(detail()).queryByRole('tab', { name: 'Summary' })).toBeNull();
});

it('opens the speakers tab from the "Revisar" finding', async () => {
  renderAt('/meetings/rita');
  const banner = await within(await screen.findByRole('article')).findByText(
    /1 speaker without a confirmed name/
  );
  fireEvent.click(
    within(banner.closest('.mh-finding') as HTMLElement).getByRole('button', { name: 'Review' })
  );
  expect(tab(/Speakers/)).toHaveAttribute('aria-selected', 'true');
});

it('recovers an interrupted capture explicitly from the finding', async () => {
  renderAt('/meetings/broken');
  const recover = await within(await screen.findByRole('article')).findByRole('button', {
    name: 'Recover',
  });
  fireEvent.click(recover);
  await waitFor(() =>
    expect(calledWith(db, 'library_recover')).toEqual([{ meetingId: 'm-broken' }])
  );
  await waitFor(() =>
    expect(within(detail()).queryByRole('button', { name: 'Recover' })).toBeNull()
  );
  expect(calledWith(db, 'library_start_session')).toHaveLength(0);
});

it('retries a failed transcription with the configuration chosen earlier in this run', async () => {
  const config = { engine_version: '1', models: {}, parameters: {} };
  rememberProcessingConfig(config);
  renderAt('/meetings/failed');
  expect(
    await within(await screen.findByRole('article')).findByText(
      /Transcription stopped: model file changed/
    )
  ).toBeInTheDocument();
  fireEvent.click(within(detail()).getByRole('button', { name: 'Try again' }));
  await waitFor(() =>
    expect(calledWith(db, 'library_process')).toEqual([{ meetingId: 'm-failed', config }])
  );
  await waitFor(() =>
    expect(useCaptureStore.getState().status?.processing?.meetingId).toBe('m-failed')
  );
});

it('sends "Transcrever" to the transcript configuration when no configuration is known', async () => {
  renderAt('/meetings/daily');
  const button = await within(await screen.findByRole('article')).findByRole('button', {
    name: 'Transcribe',
  });
  fireEvent.click(button);
  expect(tab('Transcript')).toHaveAttribute('aria-selected', 'true');
  expect(calledWith(db, 'library_process')).toHaveLength(0);
  await waitFor(() => expect(screen.getByLabelText('Model configuration')).toHaveFocus());
});

it('records a planned meeting only through startCapture with the session', async () => {
  renderAt('/meetings/planned');
  const article = await screen.findByRole('article');
  expect(await within(article).findByText(/The agenda is empty/)).toBeInTheDocument();
  fireEvent.click(within(article).getByRole('button', { name: 'Record this meeting' }));
  await waitFor(() => expect(calledWith(db, 'library_start_session')).toHaveLength(1));
  expect(calledWith(db, 'library_start_session')[0]).toMatchObject({
    sessionId: 'planned',
    micSource: 'mic',
    outputSource: 'out.monitor',
  });
  expect(calledWith(db, 'library_start')).toHaveLength(0);
  expect(calledWith(db, 'library_pause')).toHaveLength(0);
  expect(useCaptureStore.getState().liveSession).toEqual({
    sessionId: 'planned',
    title: 'Committee',
  });
});

it('creates the session for an Outlook event, then records it and seeds the invitees', async () => {
  const router = renderAt('/meetings?event=e-planning');
  const article = await screen.findByRole('article');
  expect(within(article).getByText(/2 invitees in Outlook/)).toBeInTheDocument();
  fireEvent.click(within(article).getByRole('button', { name: 'Record this meeting' }));
  await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/meetings\/s-new-/));
  const [created] = calledWith(db, 'library_create_session');
  expect(created.input).toMatchObject({ title: 'Q4 planning', status: 'planned' });
  const [started] = calledWith(db, 'library_start_session');
  expect(started.sessionId).toMatch(/^s-new-/);
  expect(calledWith(db, 'library_set_participant_context')[0].participants).toHaveLength(2);
  expect(calledWith(db, 'library_start')).toHaveLength(0);
});

it('labels the transcript tab "Live" and hides record while this meeting is captured', async () => {
  useCaptureStore.setState({
    status: {
      active: {
        meetingId: 'm-daily',
        paused: false,
        elapsedMs: 65_000,
        mic: { peak: 0, lastBlockMs: null, error: null },
        output: { peak: 0, lastBlockMs: null, error: null },
      },
      error: null,
    },
  });
  renderAt('/meetings/daily');
  const article = await screen.findByRole('article');
  expect(within(article).getByRole('tab', { name: 'Live' })).toBeInTheDocument();
  expect(within(article).queryByRole('button', { name: 'Record this meeting' })).toBeNull();
  expect(article.querySelector('.cx-live-badge')).not.toBeNull();
  expect(within(article).queryByRole('button', { name: 'Transcribe' })).toBeNull();
});

it('renames only after explicit submission, Escape cancels, a failure keeps the draft', async () => {
  renderAt('/meetings/daily');
  const article = await screen.findByRole('article');
  fireEvent.click(within(article).getByRole('button', { name: 'Rename meeting' }));
  const input = within(article).getByRole('textbox', { name: 'Title' });
  fireEvent.change(input, { target: { value: 'Discarded' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(calledWith(db, 'library_update_session')).toHaveLength(0);
  expect(within(article).getByRole('button', { name: 'Rename meeting' })).toHaveFocus();
  db.failUpdate = true;
  fireEvent.click(within(article).getByRole('button', { name: 'Rename meeting' }));
  fireEvent.change(within(article).getByRole('textbox', { name: 'Title' }), {
    target: { value: 'Daily v2' },
  });
  fireEvent.click(within(article).getByRole('button', { name: 'Save' }));
  expect(await within(article).findByText(/Could not rename/)).toBeInTheDocument();
  expect(within(article).getByRole('textbox', { name: 'Title' })).toHaveValue('Daily v2');
  db.failUpdate = false;
  fireEvent.click(within(article).getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(within(article).getByRole('heading', { level: 2 })).toHaveTextContent('Daily v2')
  );
  expect(calledWith(db, 'library_update_session').at(-1)).toMatchObject({
    sessionId: 'daily',
    input: { title: 'Daily v2', status: 'planned' },
  });
});

it('merges Outlook invitees into existing participants and reports the 100 limit before writing', async () => {
  db.sessions[0] = { ...db.sessions[0], starts_at: db.events[0].startsAt, title: 'Q4 planning' };
  db.contexts['m-rita'] = [{ name: 'Rita S.', email: 'RITA@example.com' }];
  renderAt('/meetings/rita');
  const article = await screen.findByRole('article');
  fireEvent.click(await within(article).findByRole('button', { name: 'Edit participants' }));
  const sheet = await screen.findByRole('dialog', { name: 'Participants' });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Bring 2 invitees from Outlook' }));
  await waitFor(() => expect(calledWith(db, 'library_set_participant_context')).toHaveLength(1));
  expect(db.contexts['m-rita']).toEqual([
    { name: 'Rita S.', email: 'RITA@example.com' },
    { name: 'Marcos Lima', email: 'marcos@example.com' },
  ]);
  db.contexts['m-rita'] = Array.from({ length: 99 }, (_, i) => ({ name: `P${i}`, email: null }));
  fireEvent.click(within(sheet).getByRole('button', { name: 'Bring 2 invitees from Outlook' }));
  expect(await within(sheet).findByText(/up to 100 candidates/)).toBeInTheDocument();
  expect(calledWith(db, 'library_set_participant_context')).toHaveLength(1);
  act(() => fireEvent.keyDown(sheet, { key: 'Escape' }));
});
