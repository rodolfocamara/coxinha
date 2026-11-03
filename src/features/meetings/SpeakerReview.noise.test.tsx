import { changeControl } from '../../test/changeControl';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { SpeakerReview } from './SpeakerReview';
import { ProcessingPanel } from './ProcessingPanel';
import { library, type ProcessingReport } from './library';
vi.mock('./library', () => ({
  library: {
    processing: vi.fn(),
    recognition: vi.fn(),
    participantContext: vi.fn(),
    confirmSpeaker: vi.fn(),
    rejectSpeaker: vi.fn(),
    revokeAssignment: vi.fn(),
    retryVoice: vi.fn(),
    createPerson: vi.fn(),
    speakerLevels: vi.fn(),
  },
}));

const turn = (id: string, track: string, speaker: string, seconds: [number, number]) => ({
  id,
  track,
  speaker,
  start_ms: seconds[0] * 1000,
  end_ms: seconds[1] * 1000,
});
/** The owner on the mic, the room 27 dB under, a brief output cluster. */
const report: ProcessingReport = {
  job: 'job',
  segments: [],
  warnings: [],
  corrections: {},
  assignments: [],
  turns: [
    turn('owner', 'mic', 'speaker-1', [0, 300]),
    turn('room', 'mic', 'speaker-2', [300, 340]),
    turn('guest', 'output', 'speaker-3', [0, 600]),
    turn('noise', 'output', 'speaker-4', [600, 608]),
  ],
};
const levels = [
  { track: 'mic', speaker: 'speaker-1', levelDb: -39.4 },
  { track: 'mic', speaker: 'speaker-2', levelDb: -66.6 },
];
const props = {
  meetingId: 'meeting',
  report,
  data: { jobs: [], report, people: [{ id: 'ana', name: 'Ana' }] },
  disabled: false,
  onSeek: vi.fn(),
  act: async (action: () => Promise<unknown>) => {
    await action();
  },
};
const row = (track: string, speaker: string) =>
  screen.getByRole('group', { name: `${i18n.t(`library.${track}`)} · ${speaker}` });

beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('en');
  vi.mocked(library.recognition).mockResolvedValue({
    job: 'job',
    calibrationStatus: 'uncalibrated',
    profileGeneration: 0,
    speakers: [],
  });
  vi.mocked(library.participantContext).mockResolvedValue([]);
  vi.mocked(library.speakerLevels).mockResolvedValue(levels);
});

for (const locale of ['en', 'pt-BR'])
  it(`folds room bleed and brief clusters, still nameable, in ${locale}`, async () => {
    await i18n.changeLanguage(locale);
    render(<SpeakerReview {...props} />);
    const group = await screen.findByText(i18n.t('speakerNaming.foldedGroup', { count: 2 }));
    const folded = within(group.closest('details')!);
    expect(folded.getByRole('group', { name: /speaker-2/ })).toHaveTextContent(
      i18n.t('speakerNaming.foldedBleed')
    );
    expect(folded.getByRole('group', { name: /speaker-4/ })).toHaveTextContent(
      i18n.t('speakerNaming.foldedBrief')
    );
    expect(
      screen.getByRole('heading', { name: i18n.t('speakerNaming.heading', { count: 2 }) })
    ).toBeInTheDocument();
    expect(folded.getAllByRole('combobox')).toHaveLength(2);
  });

it('applies only the brief rule while levels are unavailable', async () => {
  vi.mocked(library.speakerLevels).mockRejectedValue(new Error('no microphone'));
  render(<SpeakerReview {...props} />);
  expect(
    await screen.findByText(i18n.t('speakerNaming.foldedGroup', { count: 1 }))
  ).toBeInTheDocument();
  await waitFor(() => expect(library.speakerLevels).toHaveBeenCalledWith('job'));
  expect(row('mic', 'speaker-2').closest('details')).toBeNull();
});

it('marks a speaker as not a participant and restores it', async () => {
  const view = render(<SpeakerReview {...props} />);
  fireEvent.click(
    within(row('output', 'speaker-3')).getByRole('button', {
      name: i18n.t('speakerNaming.notParticipant'),
    })
  );
  await waitFor(() =>
    expect(library.rejectSpeaker).toHaveBeenCalledWith(
      'job',
      'speaker-3',
      i18n.t('speakerNaming.notParticipantOrigin'),
      'output'
    )
  );
  const rejected = {
    ...report,
    assignments: [
      {
        id: 'r',
        track: 'output',
        speaker: 'speaker-3',
        person_id: null,
        state: 'rejected',
        name: null,
      },
    ],
  };
  view.rerender(
    <SpeakerReview {...props} report={rejected} data={{ ...props.data, report: rejected }} />
  );
  expect(screen.queryByRole('group', { name: /speaker-3/ })).toBeNull();
  expect(screen.getByText(i18n.t('speakerNaming.rejectedGroup', { count: 1 }))).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: i18n.t('speakerNaming.heading', { count: 1 }) })
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('speakerNaming.undo') }));
  await waitFor(() =>
    expect(library.revokeAssignment).toHaveBeenCalledWith('r', i18n.t('speakerNaming.undoOrigin'))
  );
});

it('a named speaker needs a reason to become not a participant', async () => {
  const named = {
    ...report,
    assignments: [
      {
        id: 'a',
        track: 'output',
        speaker: 'speaker-3',
        person_id: 'ana',
        state: 'confirmed',
        name: 'Ana',
        voice: { state: 'enrolled' as const, samples: 16 },
      },
    ],
  };
  render(<SpeakerReview {...props} report={named} data={{ ...props.data, report: named }} />);
  const card = within(row('output', 'speaker-3'));
  expect(card.getByText(i18n.t('speakerNaming.voiceEnrolled', { count: 16 }))).toBeInTheDocument();
  fireEvent.click(card.getByRole('button', { name: i18n.t('speakerNaming.change') }));
  const action = card.getByRole('button', { name: i18n.t('speakerNaming.notParticipant') });
  expect(action).toBeDisabled();
  changeControl(card.getByRole('textbox', { name: i18n.t('speakers.decisionOrigin') }), {
    target: { value: 'Background voice' },
  });
  fireEvent.click(action);
  await waitFor(() =>
    expect(library.rejectSpeaker).toHaveBeenCalledWith(
      'job',
      'speaker-3',
      'Background voice',
      'output'
    )
  );
});

for (const [voice, text] of [
  [{ state: 'pending', samples: 0 }, 'speakerNaming.voicePending'],
  [{ state: 'off', samples: 0 }, 'speakerNaming.voiceOff'],
] as const)
  it(`shows a ${voice.state} voice`, async () => {
    const named = {
      ...report,
      assignments: [
        {
          id: 'a',
          track: 'output',
          speaker: 'speaker-3',
          person_id: 'ana',
          state: 'confirmed',
          name: 'Ana',
          voice,
        },
      ],
    };
    render(<SpeakerReview {...props} report={named} data={{ ...props.data, report: named }} />);
    expect(within(row('output', 'speaker-3')).getByText(i18n.t(text))).toBeInTheDocument();
  });

it('shows a failed voice and retries it', async () => {
  const named = {
    ...report,
    assignments: [
      {
        id: 'a',
        track: 'output',
        speaker: 'speaker-3',
        person_id: 'ana',
        state: 'confirmed',
        name: 'Ana',
        voice: { state: 'failed' as const, samples: 0, error: 'no eligible voice samples' },
      },
    ],
  };
  render(<SpeakerReview {...props} report={named} data={{ ...props.data, report: named }} />);
  const card = within(row('output', 'speaker-3'));
  expect(
    card.getByText(i18n.t('speakerNaming.voiceFailed', { reason: 'no eligible voice samples' }), {
      exact: false,
    })
  ).toBeInTheDocument();
  fireEvent.click(card.getByRole('button', { name: i18n.t('speakerNaming.voiceRetry') }));
  await waitFor(() => expect(library.retryVoice).toHaveBeenCalledWith('a'));
});

it('names speakers while a call is being recorded', async () => {
  vi.mocked(library.processing).mockResolvedValue({ ...props.data });
  render(
    <ProcessingPanel
      meetingId="meeting"
      closed
      view="people"
      status={{
        active: {
          meetingId: 'other',
          paused: false,
          elapsedMs: 1,
          mic: { peak: 0, lastBlockMs: 0, error: null },
          output: { peak: 0, lastBlockMs: 0, error: null },
        },
        error: null,
      }}
      onStatus={vi.fn()}
      onSeek={vi.fn()}
    />
  );
  const card = within(await screen.findByRole('group', { name: /speaker-3/ }));
  changeControl(card.getByRole('combobox'), { target: { value: 'ana' } });
  const confirm = card.getByRole('button', { name: i18n.t('library.processing.confirm') });
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(library.confirmSpeaker).toHaveBeenCalledWith(
      'job',
      'speaker-3',
      'ana',
      i18n.t('speakers.defaultOrigin'),
      'output'
    )
  );
});
