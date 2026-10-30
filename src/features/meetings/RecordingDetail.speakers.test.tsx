import { changeControl } from '../../test/changeControl';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { RecordingDetail } from './RecordingDetail';
import { library, type LibraryDetail, type ProcessingDetail } from './library';
vi.mock('./library', () => ({
  library: {
    audioUrl: (path: string) => `asset://granted/${path}`,
    processing: vi.fn(),
    recognition: vi.fn(),
    participantContext: vi.fn(),
    confirmSpeaker: vi.fn(),
    editSegment: vi.fn(),
  },
}));
const detail: LibraryDetail = {
  meeting: { id: 'm', title: 'Meeting', captureState: 'finished', createdAt: '' },
  manifest: null,
  audio: { mic: 'mic.wav', output: 'output.wav' },
  inference: 'local',
};
const data: ProcessingDetail = {
  jobs: [],
  people: [{ id: 'ana', name: 'Ana' }],
  report: {
    job: 'job',
    warnings: [],
    assignments: [],
    corrections: {},
    segments: [
      {
        id: 'text',
        track: 'output',
        speaker: 'speaker-1',
        start_ms: 2000,
        end_ms: 3000,
        text: 'Original words',
      },
    ],
    turns: [
      { id: 'mic', track: 'mic', speaker: 'speaker-1', start_ms: 1000, end_ms: 2000 },
      { id: 'output', track: 'output', speaker: 'speaker-1', start_ms: 5000, end_ms: 7000 },
    ],
  },
};
const props = {
  detail,
  status: { active: null, error: null },
  onStatus: vi.fn(),
  onRecover: vi.fn(),
  compact: true,
  people: true,
  audioExpanded: false,
  showProcessing: false,
  processingPanelId: 'session-panel-transcript',
  playbackScope: 'people',
};
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('en');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement
  ) {
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.mocked(library.processing).mockResolvedValue(data);
  vi.mocked(library.recognition).mockResolvedValue({
    job: 'job',
    calibrationStatus: 'uncalibrated',
    profileGeneration: 0,
    speakers: [],
  });
  vi.mocked(library.participantContext).mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());
const row = (track: string) =>
  within(screen.getByRole('group', { name: `${i18n.t(`library.${track}`)} · speaker-1` }));
it('joint controls play both granted tracks without triggering individual-track exclusion', async () => {
  const view = render(<RecordingDetail {...props} audioExpanded />);
  await screen.findAllByRole('button', { name: /Play excerpt/ });
  const audio = [...view.container.querySelectorAll('audio')];
  const playing = new Set<HTMLMediaElement>();
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(function (this: HTMLMediaElement) {
    playing.add(this);
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(function (this: HTMLMediaElement) {
    playing.delete(this);
  });
  for (const player of audio) {
    Object.defineProperty(player, 'duration', { value: 20 });
    Object.defineProperty(player, 'paused', { get: () => !playing.has(player) });
    fireEvent.loadedMetadata(player);
  }
  vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Listen to meeting' }));
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  // One bounded-player stop and one joint stop happen before starting both.
  // onPlay must not pause one source when the other starts.
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(2);
  expect(audio.every((player) => !player.paused)).toBe(true);
  expect(screen.getByRole('button', { name: 'Pause meeting audio' })).toBeVisible();
  fireEvent.click(row('output').getByRole('button', { name: /Play excerpt/ }));
  expect(screen.getByRole('button', { name: 'Listen to meeting' })).toBeVisible();
  expect(audio[1].currentTime).toBe(5);
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(3);
});
it('plays the correct granted track while keeping focus on the visible excerpt control', async () => {
  const { container } = render(<RecordingDetail {...props} />);
  const listen = await screen.findAllByRole('button', { name: /Play excerpt/ });
  const audio = [...container.querySelectorAll('audio')];
  expect(audio.map((p) => p.getAttribute('src'))).toEqual([
    'asset://granted/mic.wav',
    'asset://granted/output.wav',
  ]);
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  listen[1].focus();
  fireEvent.click(listen[1]);
  expect(audio[1].currentTime).toBe(5);
  expect(audio[0].currentTime).toBe(0);
  expect(listen[1]).toHaveFocus();
  expect(audio[1]).not.toBeVisible();
  expect(listen[1]).toHaveAttribute('aria-pressed', 'true');
  audio[1].currentTime = 7;
  fireEvent.timeUpdate(audio[1]);
  expect(row('output').getByRole('button', { name: /Play excerpt/ })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
});
it('shares processing across tabs, retains text corrections and stops audio on tab and meeting switches', async () => {
  const view = render(<RecordingDetail {...props} />);
  await screen.findAllByRole('button', { name: /Play excerpt/ });
  fireEvent.click(row('mic').getByRole('button', { name: /Play excerpt/ }));
  vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
  view.rerender(
    <RecordingDetail {...props} people={false} showProcessing playbackScope="transcript" />
  );
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  expect(screen.queryByRole('combobox', { name: 'Person to confirm' })).toBeNull();
  expect(screen.getByText('Original words')).toBeInTheDocument();
  expect(library.processing).toHaveBeenCalledTimes(1);
  changeControl(screen.getByLabelText('Separate human correction'), {
    target: { value: 'Edited words' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
  await waitFor(() =>
    expect(library.editSegment).toHaveBeenCalledWith('m', 'job:text', 'Edited words')
  );
  view.rerender(<RecordingDetail {...props} />);
  await screen.findAllByRole('button', { name: /Play excerpt/ });
  fireEvent.click(row('mic').getByRole('button', { name: /Play excerpt/ }));
  const oldAudio = view.container.querySelector('audio')!;
  const pauseOld = vi.spyOn(oldAudio, 'pause');
  view.rerender(
    <RecordingDetail {...props} detail={{ ...detail, meeting: { ...detail.meeting, id: 'new' } }} />
  );
  expect(pauseOld).toHaveBeenCalled();
});
it('reports playback failures and reconciles a persisted confirmation after a command follow-up fails', async () => {
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('unsupported media'));
  const view = render(<RecordingDetail {...props} />);
  await screen.findAllByRole('button', { name: /Play excerpt/ });
  fireEvent.click(row('output').getByRole('button', { name: /Play excerpt/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('library.playbackError'));
  view.rerender(<RecordingDetail {...props} />);
  vi.mocked(library.confirmSpeaker).mockRejectedValueOnce(
    new Error('confirmation saved; command follow-up failed')
  );
  vi.mocked(library.processing).mockResolvedValue({
    ...data,
    report: {
      ...data.report!,
      assignments: [
        {
          id: 'a',
          track: 'output',
          speaker: 'speaker-1',
          person_id: 'ana',
          name: 'Ana',
          state: 'confirmed',
        },
      ],
    },
  });
  const output = row('output');
  changeControl(output.getByRole('combobox'), { target: { value: 'ana' } });
  changeControl(output.getByRole('textbox'), { target: { value: 'Human evidence' } });
  fireEvent.click(output.getByRole('button', { name: 'Confirm identity' }));
  expect(await screen.findByText('Confirmed identity: Ana')).toBeInTheDocument();
  expect(row('output').queryByRole('checkbox')).toBeNull();
  expect(
    screen.getAllByRole('alert').some((a) => a.textContent?.includes('command follow-up failed'))
  ).toBe(true);
  await act(async () => {});
});

it.each(['session', 'legacy'])(
  'R3 transcript links seek and focus visible native audio without autoplay in %s',
  async (context) => {
    const view = render(
      <RecordingDetail
        {...props}
        people={false}
        showProcessing
        playbackScope="transcript"
        processingPanelId={context === 'legacy' ? undefined : 'session-panel-transcript'}
        audioExpanded={context === 'legacy'}
      />
    );
    const segment = await screen.findByRole('button', { name: /0:02 · speaker-1/ });
    fireEvent.click(segment);
    const output = view.container.querySelectorAll('audio')[1];
    expect(output.currentTime).toBe(2);
    expect(output).toBeVisible();
    expect(output).toHaveFocus();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  }
);

it('R3 legacy transcript seek preserves an already playing full track instead of making another play request', async () => {
  const view = render(
    <RecordingDetail
      {...props}
      people={false}
      showProcessing
      processingPanelId={undefined}
      audioExpanded
    />
  );
  const segment = await screen.findByRole('button', { name: /0:02 · speaker-1/ });
  const output = view.container.querySelectorAll('audio')[1];
  vi.spyOn(output, 'paused', 'get').mockReturnValue(false);
  vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
  fireEvent.click(segment);
  expect(output.currentTime).toBe(2);
  expect(output).toHaveFocus();
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
});
