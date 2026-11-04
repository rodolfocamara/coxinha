import { changeControl } from '../../test/changeControl';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { VoiceMemory } from './VoiceMemory';
import { PeopleDirectory } from '../meetings/PeopleDirectory';
import { library } from '../meetings/library';
import { voiceCuration } from '../meetings/voiceCuration';
import { initialCaptureState, useCaptureStore } from '../capture/captureStore';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../sessions/sessions', () => ({ useSessions: () => ({ data: [] }) }));
vi.mock('../meetings/library', () => ({
  library: {
    available: vi.fn(),
    list: vi.fn(),
    voiceMemory: vi.fn(),
    forgetVoice: vi.fn(),
    rememberVoice: vi.fn(),
    retryVoice: vi.fn(),
  },
}));
vi.mock('../meetings/voiceCuration', async (original) => ({
  ...(await original<typeof import('../meetings/voiceCuration')>()),
  voiceCuration: { profilesPage: vi.fn(), samplesPage: vi.fn(), revoke: vi.fn() },
}));

const memory = { personId: 'ana', off: false, pending: 0, failed: [] };
const run = async (action: () => Promise<unknown>) => {
  await action();
};
const props = {
  personId: 'ana',
  version: 0,
  disabled: false,
  act: run,
  meetingTitle: (id: string) => `Meeting ${id}`,
};
const k = (name: string, options?: Record<string, unknown>) =>
  i18n.t(`people.voiceMemory.${name}`, options);

beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('en');
  useCaptureStore.setState({ ...initialCaptureState });
});
afterEach(cleanup);

for (const locale of ['en', 'pt-BR'])
  it(`forgets the whole voice with a reason in ${locale}`, async () => {
    await i18n.changeLanguage(locale);
    vi.mocked(library.voiceMemory).mockResolvedValue(memory);
    render(<VoiceMemory {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: k('forget') }));
    const confirm = screen.getByRole('button', { name: k('forgetConfirm') });
    expect(confirm).toBeDisabled();
    changeControl(screen.getByRole('textbox', { name: k('forgetReason') }), {
      target: { value: 'The person asked' },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(library.forgetVoice).toHaveBeenCalledWith('ana', 'The person asked')
    );
  });

it('turns voice memory back on', async () => {
  vi.mocked(library.voiceMemory).mockResolvedValue({ ...memory, off: true });
  render(<VoiceMemory {...props} />);
  expect(await screen.findByText(k('off'))).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: k('forget') })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: k('rememberAgain') }));
  await waitFor(() => expect(library.rememberVoice).toHaveBeenCalledWith('ana'));
});

it('lists pending and failed confirmations and retries a failure', async () => {
  vi.mocked(library.voiceMemory).mockResolvedValue({
    ...memory,
    pending: 2,
    failed: [{ assignmentId: 'a1', meetingId: 'm1', error: 'no eligible voice samples' }],
  });
  render(<VoiceMemory {...props} />);
  expect(await screen.findByText(k('pending', { count: 2 }))).toBeInTheDocument();
  expect(
    screen.getByText(k('failed', { meeting: 'Meeting m1', reason: 'no eligible voice samples' }), {
      exact: false,
    })
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: k('retry') }));
  await waitFor(() => expect(library.retryVoice).toHaveBeenCalledWith('a1'));
});

it('Pessoas reloads after a deferred batch of voices', async () => {
  vi.mocked(library.available).mockReturnValue(true);
  vi.mocked(library.list).mockResolvedValue([]);
  vi.mocked(library.voiceMemory).mockResolvedValue(memory);
  vi.mocked(voiceCuration.profilesPage).mockResolvedValue({
    profileGeneration: 1,
    profiles: [{ personId: 'ana', name: 'Ana Prado' }],
    nextCursor: null,
    scannedRows: 1,
  });
  vi.mocked(voiceCuration.samplesPage).mockResolvedValue({
    profileGeneration: 1,
    personId: 'ana',
    samples: [],
    nextCursor: null,
    scannedRows: 0,
  });
  render(<PeopleDirectory />);
  expect(await screen.findByRole('heading', { level: 2, name: 'Ana Prado' })).toBeVisible();
  const before = vi.mocked(voiceCuration.profilesPage).mock.calls.length;
  act(() =>
    useCaptureStore.setState({ status: { active: null, error: null, voices: { generation: 1 } } })
  );
  await waitFor(() =>
    expect(vi.mocked(voiceCuration.profilesPage).mock.calls.length).toBeGreaterThan(before)
  );
  await waitFor(() => expect(library.voiceMemory).toHaveBeenCalledTimes(2));
});
