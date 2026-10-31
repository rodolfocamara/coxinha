import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { PeopleDirectory } from './PeopleDirectory';
import { library } from './library';
import { voiceCuration, type SamplesPage } from './voiceCuration';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
const sessionData = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock('../sessions/sessions', () => ({ useSessions: () => sessionData }));
vi.mock('./library', () => ({
  library: {
    available: vi.fn(),
    createPerson: vi.fn(),
    list: vi.fn(),
    detail: vi.fn(),
    audioUrl: vi.fn(),
  },
}));
vi.mock('./voiceCuration', async (original) => ({
  ...(await original<typeof import('./voiceCuration')>()),
  voiceCuration: { profilesPage: vi.fn(), samplesPage: vi.fn(), revoke: vi.fn() },
}));

const tr = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);
const space = { model: 'm', revision: 'r', model_hash: 'h', preprocessing: 'p', dimension: 2 };
const sample = (sampleId: string, state: 'active' | 'revoked' = 'active', meetingId = 'm1') => ({
  sampleId,
  assignmentId: 'a',
  assignmentRevision: 1,
  currentAssignmentRevision: 1,
  state,
  spaceId: 's',
  space,
  meetingId,
  track: 'mic',
  startMs: 11_000,
  endMs: 23_000,
  createdAt: '2026-10-28 16:20:00',
  revokedAt: null,
});
const samples: Record<string, SamplesPage['samples']> = {
  ana: [sample('sample-0'), sample('sample-1', 'active', 'm2'), sample('sample-2', 'revoked')],
  bruno: [],
};

beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('en');
  sessionData.data = [
    { id: 's1', meeting_id: 'm1', title: 'Weekly de TI', starts_at: '2026-10-24T10:00:00Z' },
  ];
  vi.mocked(library.available).mockReturnValue(true);
  vi.mocked(library.list).mockResolvedValue([
    { id: 'm2', title: 'Imported interview', createdAt: '', captureState: 'finished' },
  ]);
  vi.mocked(voiceCuration.profilesPage).mockResolvedValue({
    profileGeneration: 1,
    profiles: [
      { personId: 'ana', name: 'Ana Prado' },
      { personId: 'bruno', name: 'Bruno' },
    ],
    nextCursor: null,
    scannedRows: 2,
  });
  vi.mocked(voiceCuration.samplesPage).mockImplementation(async (personId) => ({
    profileGeneration: 1,
    personId,
    samples: samples[personId] ?? [],
    nextCursor: null,
    scannedRows: 0,
  }));
  vi.mocked(voiceCuration.revoke).mockResolvedValue(null);
});
afterEach(cleanup);

const row = (name: RegExp) =>
  within(screen.getByRole('list', { name: tr('people.listLabel') })).getByRole('button', { name });

it('opens the first person and loads samples only for the person being viewed', async () => {
  render(<PeopleDirectory />);
  expect(await screen.findByRole('heading', { level: 2, name: 'Ana Prado' })).toBeVisible();
  expect(row(/Ana Prado/)).toHaveAttribute('aria-current', 'true');
  expect(voiceCuration.samplesPage).toHaveBeenCalledExactlyOnceWith('ana', null);
  // Counts and meetings come from the loaded samples only.
  await waitFor(() =>
    expect(row(/Ana Prado/)).toHaveTextContent(tr('people.row.samples', { count: 2 }))
  );
  expect(row(/Ana Prado/)).toHaveTextContent(tr('people.row.meetings', { count: 2 }));
  expect(row(/Bruno/)).toHaveTextContent(tr('people.row.unknown'));
  // Samples name their meeting: session title, else the recording title.
  expect(screen.getAllByText(/Weekly de TI · 0:11–0:23/)).toHaveLength(2);
  expect(screen.getByText(/Imported interview · 0:11–0:23/)).toBeVisible();

  fireEvent.click(row(/Bruno/));
  expect(await screen.findByText(tr('people.detail.noSamples'))).toBeVisible();
  expect(voiceCuration.samplesPage).toHaveBeenLastCalledWith('bruno', null);
  // The row count follows the loaded page, one render after the detail.
  await waitFor(() => expect(row(/Bruno/)).toHaveTextContent(tr('people.row.noSamples')));
});

it('shows backend totals on every row without loading each person', async () => {
  vi.mocked(voiceCuration.profilesPage).mockResolvedValue({
    profileGeneration: 1,
    profiles: [
      { personId: 'ana', name: 'Ana Prado', activeSamples: 7, sampleMeetings: 3 },
      { personId: 'bruno', name: 'Bruno', activeSamples: 0, sampleMeetings: 0 },
    ],
    nextCursor: null,
    scannedRows: 2,
  });
  render(<PeopleDirectory />);
  await screen.findByRole('heading', { level: 2, name: 'Ana Prado' });
  await waitFor(() =>
    expect(row(/Ana Prado/)).toHaveTextContent(tr('people.row.samples', { count: 7 }))
  );
  expect(row(/Ana Prado/)).toHaveTextContent(tr('people.row.meetings', { count: 3 }));
  expect(row(/Bruno/)).toHaveTextContent(tr('people.row.noSamples'));
  expect(voiceCuration.samplesPage).not.toHaveBeenCalledWith('bruno', null);
});

it('moves through people with the arrow keys, Home and End', async () => {
  render(<PeopleDirectory />);
  await screen.findByRole('heading', { level: 2, name: 'Ana Prado' });
  const ana = row(/Ana Prado/);
  expect(ana).toHaveAttribute('tabindex', '0');
  expect(row(/Bruno/)).toHaveAttribute('tabindex', '-1');
  ana.focus();
  fireEvent.keyDown(ana, { key: 'ArrowDown' });
  expect(row(/Bruno/)).toHaveFocus();
  expect(row(/Bruno/)).toHaveAttribute('aria-current', 'true');
  expect(await screen.findByRole('heading', { level: 2, name: 'Bruno' })).toBeVisible();
  fireEvent.keyDown(row(/Bruno/), { key: 'Home' });
  expect(row(/Ana Prado/)).toHaveFocus();
  fireEvent.keyDown(row(/Ana Prado/), { key: 'End' });
  expect(row(/Bruno/)).toHaveFocus();
});

it('searches the loaded people without extra reads', async () => {
  render(<PeopleDirectory />);
  await screen.findByRole('heading', { level: 2, name: 'Ana Prado' });
  fireEvent.change(screen.getByRole('searchbox', { name: tr('people.search') }), {
    target: { value: 'zé' },
  });
  expect(screen.getByText(tr('people.noMatch'))).toBeVisible();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bru' } });
  expect(row(/Bruno/)).toBeVisible();
  expect(screen.queryByRole('button', { name: /Ana Prado/ })).toBeNull();
  expect(voiceCuration.profilesPage).toHaveBeenCalledTimes(1);
});

it('revokes a sample only after an inline confirmation with a reason, then reloads fresh', async () => {
  const user = userEvent.setup();
  render(<PeopleDirectory />);
  await screen.findByRole('heading', { level: 2, name: 'Ana Prado' });
  const revokeButtons = await screen.findAllByRole('button', { name: tr('people.sample.revoke') });
  // Revoked samples stay visible as history, without a revoke action.
  expect(revokeButtons).toHaveLength(2);
  expect(screen.getByText(tr('people.sample.states.revoked'))).toBeVisible();

  await user.click(revokeButtons[0]);
  let form = screen.getByRole('group', { name: tr('people.revoke.title') });
  await user.click(within(form).getByRole('button', { name: tr('people.revoke.cancel') }));
  expect(screen.queryByRole('group', { name: tr('people.revoke.title') })).toBeNull();
  expect(voiceCuration.revoke).not.toHaveBeenCalled();

  await user.click(screen.getAllByRole('button', { name: tr('people.sample.revoke') })[0]);
  form = screen.getByRole('group', { name: tr('people.revoke.title') });
  const confirm = within(form).getByRole('button', { name: tr('people.revoke.confirm') });
  expect(confirm).toBeDisabled();
  const reason = within(form).getByRole('textbox', {
    name: new RegExp(tr('people.revoke.reason')),
  });
  expect(reason).toHaveFocus();
  await user.type(reason, ' Wrong speaker ');
  await user.click(confirm);
  await user.click(confirm);
  expect(voiceCuration.revoke).toHaveBeenCalledExactlyOnceWith('ana', 'sample-0', 'Wrong speaker');
  await waitFor(() => expect(voiceCuration.profilesPage).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(voiceCuration.samplesPage).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole('heading', { level: 2, name: 'Ana Prado' })).toBeVisible();
});

it('after a failed revoke shows the error and requires an explicit restart (spec 0078)', async () => {
  const user = userEvent.setup();
  vi.mocked(voiceCuration.revoke).mockRejectedValue(new Error('voice_curation_busy'));
  render(<PeopleDirectory />);
  await user.click((await screen.findAllByRole('button', { name: tr('people.sample.revoke') }))[0]);
  const form = screen.getByRole('group', { name: tr('people.revoke.title') });
  await user.type(within(form).getByRole('textbox'), 'Mistake');
  await user.click(within(form).getByRole('button', { name: tr('people.revoke.confirm') }));
  expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
  // The view may no longer match the store: mutations stay locked until restart.
  const restart = (await screen.findAllByRole('button', { name: tr('people.restart') }))[0];
  for (const button of screen.getAllByRole('button', { name: tr('people.sample.revoke') }))
    expect(button).toBeDisabled();
  expect(voiceCuration.revoke).toHaveBeenCalledTimes(1);
  await user.click(restart);
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: tr('people.sample.revoke') })[0]).toBeEnabled()
  );
});

it('opens a recent meeting in Reuniões when its session is known', async () => {
  render(<PeopleDirectory />);
  await screen.findByRole('heading', { level: 2, name: 'Ana Prado' });
  const inspector = screen.getByRole('complementary', { name: tr('people.inspector.recent') });
  // The imported recording has no session: listed, but not a button.
  // Recent meetings come from the samples, which load after the heading.
  expect((await within(inspector).findByText(/Imported interview/)).closest('button')).toBeNull();
  fireEvent.click(await within(inspector).findByRole('button', { name: /Weekly de TI/ }));
  expect(navigate).toHaveBeenCalledWith(
    expect.objectContaining({ to: '/meetings/$sessionId', params: { sessionId: 's1' } })
  );
  expect(within(inspector).getByText(tr('people.inspector.privacy'))).toBeVisible();
});

it('plays a sample from its meeting track and can stop it', async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.mocked(library.detail).mockResolvedValue({
    meeting: { id: 'm1', title: 'Weekly', createdAt: '', captureState: 'finished' },
    manifest: null,
    audio: { mic: '/vault/m1/mic.wav' },
    inference: 'local',
  });
  vi.mocked(library.audioUrl).mockReturnValue('asset://m1/mic.wav');
  render(<PeopleDirectory />);
  await screen.findByRole('heading', { level: 2, name: 'Ana Prado' });
  const listen = (await screen.findAllByRole('button', { name: tr('people.sample.listen') }))[0];
  fireEvent.click(listen);
  await waitFor(() => expect(play).toHaveBeenCalled());
  expect(library.detail).toHaveBeenCalledWith('m1');
  expect(library.audioUrl).toHaveBeenCalledWith('/vault/m1/mic.wav');
  const stop = screen.getByRole('button', { name: tr('people.sample.stop') });
  expect(stop).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(stop);
  expect(screen.queryByRole('button', { name: tr('people.sample.stop') })).toBeNull();
});

it('retries a failed people read and offers creation from an empty registry', async () => {
  vi.mocked(voiceCuration.profilesPage)
    .mockRejectedValueOnce(new Error('disk'))
    .mockResolvedValue({ profileGeneration: 1, profiles: [], nextCursor: null, scannedRows: 0 });
  render(<PeopleDirectory />);
  fireEvent.click(await screen.findByRole('button', { name: tr('people.retry') }));
  expect(await screen.findByText(tr('peopleDirectory.empty.title'))).toBeVisible();
  expect(voiceCuration.profilesPage).toHaveBeenCalledTimes(2);
  expect(voiceCuration.samplesPage).not.toHaveBeenCalled();
});

it('creates a person once with consent, selects them and never enrolls audio', async () => {
  let finish!: (value: string) => void;
  vi.mocked(library.createPerson).mockImplementation(
    () => new Promise((resolve) => (finish = resolve))
  );
  render(<PeopleDirectory />);
  await screen.findByRole('heading', { level: 2, name: 'Ana Prado' });
  fireEvent.click(screen.getByRole('button', { name: tr('people.add') }));
  const dialog = await screen.findByRole('dialog', { name: tr('peopleDirectory.form.title') });
  fireEvent.change(within(dialog).getByRole('textbox', { name: /Person name/ }), {
    target: { value: ' Carla ' },
  });
  fireEvent.change(within(dialog).getByRole('textbox', { name: /Source and scope of consent/ }), {
    target: { value: ' Verbal permission ' },
  });
  const submit = within(dialog).getByRole('button', {
    name: tr('library.processing.createPerson'),
  });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(library.createPerson).toHaveBeenCalledExactlyOnceWith('Carla', 'Verbal permission');
  await act(async () => finish('carla'));
  expect(await screen.findByText(tr('people.created', { name: 'Carla' }))).toBeVisible();
  expect(await screen.findByRole('heading', { level: 2, name: 'Carla' })).toBeVisible();
  await waitFor(() => expect(voiceCuration.profilesPage).toHaveBeenCalledTimes(2));
  expect(voiceCuration.revoke).not.toHaveBeenCalled();
});

it('explains the desktop requirement in the browser preview without private reads', () => {
  vi.mocked(library.available).mockReturnValue(false);
  render(<PeopleDirectory />);
  expect(screen.getByText(tr('library.desktopRequired'))).toBeVisible();
  expect(voiceCuration.profilesPage).not.toHaveBeenCalled();
  expect(library.list).not.toHaveBeenCalled();
});
