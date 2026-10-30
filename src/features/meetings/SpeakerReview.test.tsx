import { changeControl } from '../../test/changeControl';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { SpeakerReview } from './SpeakerReview';
import { library, type ProcessingReport, type Recognition } from './library';
vi.mock('./library', () => ({
  library: {
    recognition: vi.fn(),
    participantContext: vi.fn(),
    setParticipantContext: vi.fn(),
    confirmSpeaker: vi.fn(),
    createPerson: vi.fn(),
    revokeAssignment: vi.fn(),
  },
}));
const report: ProcessingReport = {
  job: 'job',
  segments: [],
  warnings: [],
  corrections: {},
  assignments: [],
  turns: ['mic', 'output'].map((track) => ({
    id: track,
    track,
    speaker: 'speaker-1',
    start_ms: 1000,
    end_ms: 4000,
  })),
};
const recognition: Recognition = {
  job: 'job',
  calibrationStatus: 'calibrated',
  profileGeneration: 0,
  speakers: [
    {
      track: 'mic',
      speaker: 'speaker-1',
      state: 'suggested',
      reason: 'missing_policy',
      personId: 'ana',
      name: 'Ana',
      policyId: 'existing-policy',
      cosineSimilarity: null,
    },
    {
      track: 'output',
      speaker: 'speaker-1',
      state: 'unknown',
      reason: 'missing_policy',
      personId: null,
      name: null,
      policyId: null,
      cosineSimilarity: null,
    },
  ],
};
const run = async (action: () => Promise<unknown>) => {
  await action();
};
const props = {
  meetingId: 'meeting',
  report,
  data: {
    jobs: [],
    report,
    people: [
      { id: 'ana', name: 'Ana' },
      { id: 'bruno', name: 'Bruno' },
    ],
  },
  disabled: false,
  onSeek: vi.fn(),
  act: run,
};
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('en');
  vi.mocked(library.recognition).mockResolvedValue(recognition);
  vi.mocked(library.participantContext).mockResolvedValue([{ name: 'Agenda name', email: null }]);
  vi.mocked(library.createPerson).mockResolvedValue('created-id');
});
const card = (track: string) =>
  screen.getByRole('group', { name: new RegExp(`${i18n.t(`library.${track}`)} · speaker-1`) });
function select(track: string, person: string, origin = 'Reviewed this recording with the person') {
  const row = within(card(track));
  changeControl(row.getByRole('combobox'), { target: { value: person } });
  changeControl(row.getByRole('textbox'), { target: { value: origin } });
  return row;
}
for (const locale of ['en', 'pt-BR'])
  it(`keeps track selections and enrollment independent in ${locale}`, async () => {
    await i18n.changeLanguage(locale);
    render(<SpeakerReview {...props} />);
    const mic = select('mic', 'ana');
    const output = select('output', 'bruno');
    expect(mic.queryByRole('checkbox')).toBeNull();
    expect(output.queryByRole('checkbox')).toBeNull();
    expect(mic.getByRole('combobox')).toHaveValue('ana');
    fireEvent.click(output.getByRole('button', { name: i18n.t('library.processing.confirm') }));
    await waitFor(() =>
      expect(library.confirmSpeaker).toHaveBeenLastCalledWith(
        'job',
        'speaker-1',
        'bruno',
        'Reviewed this recording with the person',
        false,
        'output'
      )
    );
    fireEvent.click(mic.getByRole('button', { name: i18n.t('library.processing.confirm') }));
    await waitFor(() =>
      expect(library.confirmSpeaker).toHaveBeenLastCalledWith(
        'job',
        'speaker-1',
        'ana',
        'Reviewed this recording with the person',
        false,
        'mic'
      )
    );
    expect(mic.queryByRole('checkbox')).toBeNull();
    expect(mic.getByText(i18n.t('voiceCuration.identityOnly'))).toBeInTheDocument();
  });
it('distinguishes confirmed, proposed and unknown; selecting a suggestion never saves', async () => {
  const view = render(<SpeakerReview {...props} />);
  expect(await screen.findByText('Suggested identity: Ana')).toBeInTheDocument();
  expect(within(card('output')).getByText(i18n.t('speakers.anonymous'))).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Select person for review' }));
  expect(within(card('mic')).getByRole('combobox')).toHaveValue('ana');
  expect(library.confirmSpeaker).not.toHaveBeenCalled();
  const assigned = {
    ...report,
    assignments: [
      {
        id: 'a',
        track: 'mic',
        speaker: 'speaker-1',
        person_id: 'ana',
        name: 'Ana',
        state: 'confirmed',
      },
    ],
  };
  view.rerender(<SpeakerReview {...props} report={assigned} />);
  expect(screen.getByText('Confirmed identity: Ana')).toBeInTheDocument();
  expect(screen.queryByText('Suggested identity: Ana')).toBeNull();
});
it('never renders claim controls for unknown overlapping turns', async () => {
  const unknown = {
    ...report,
    turns: [{ id: 'unknown', speaker: 'unknown-overlap', track: 'mic', start_ms: 0, end_ms: 1000 }],
  };
  render(<SpeakerReview {...props} report={unknown} />);
  expect(screen.getByText(i18n.t('speakers.overlap'))).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByText(i18n.t('speakers.noSpeakers'))).toBeInTheDocument();
});
it('agenda names only prefill explicit creation with separate consent; the created ID is selectable', async () => {
  render(<SpeakerReview {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add a person / agenda names' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Copy name to new person' }));
  expect(screen.getByLabelText('Person name', { exact: false })).toHaveValue('Agenda name');
  const create = screen.getByRole('button', { name: 'Create persistent person' });
  expect(create).toBeDisabled();
  expect(library.createPerson).not.toHaveBeenCalled();
  changeControl(screen.getByRole('textbox', { name: /Source and scope of consent/ }), {
    target: { value: 'Written permission for identity only' },
  });
  fireEvent.click(create);
  await waitFor(() =>
    expect(library.createPerson).toHaveBeenCalledWith(
      'Agenda name',
      'Written permission for identity only'
    )
  );
  expect(within(card('mic')).getByRole('combobox')).toHaveValue('');
  const mic = select('mic', 'created-id', 'Human review');
  fireEvent.click(mic.getByRole('button', { name: 'Confirm identity' }));
  await waitFor(() =>
    expect(library.confirmSpeaker).toHaveBeenCalledWith(
      'job',
      'speaker-1',
      'created-id',
      'Human review',
      false,
      'mic'
    )
  );
});
it('corrects and revokes track identities and separately revokes legacy assignments', async () => {
  const assigned = {
    ...report,
    assignments: [
      {
        id: 'a',
        track: 'mic',
        speaker: 'speaker-1',
        person_id: 'ana',
        name: 'Ana',
        state: 'confirmed',
      },
      {
        id: 'old',
        track: null,
        speaker: 'speaker-1',
        person_id: 'ana',
        name: 'Old Ana',
        state: 'confirmed',
      },
    ],
  };
  render(<SpeakerReview {...props} report={assigned} />);
  const mic = select('mic', 'bruno', 'Corrected after listening');
  fireEvent.click(mic.getByRole('button', { name: 'Correct identity' }));
  await waitFor(() =>
    expect(library.confirmSpeaker).toHaveBeenCalledWith(
      'job',
      'speaker-1',
      'bruno',
      'Corrected after listening',
      false,
      'mic'
    )
  );
  fireEvent.click(mic.getByRole('button', { name: 'Revoke identity and voice contributions' }));
  await waitFor(() =>
    expect(library.revokeAssignment).toHaveBeenCalledWith('a', 'Corrected after listening')
  );
  changeControl(screen.getByLabelText('Reason for revoking a previous identity'), {
    target: { value: 'Legacy correction' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Revoke previous identity' }));
  await waitFor(() =>
    expect(library.revokeAssignment).toHaveBeenCalledWith('old', 'Legacy correction')
  );
  expect(within(card('output')).queryByText(/Old Ana/)).toBeNull();
});
it('resets row state and ignores recognition from an old meeting or job', async () => {
  let finish!: (value: Recognition) => void;
  vi.mocked(library.recognition).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const view = render(<SpeakerReview {...props} />);
  select('mic', 'ana', 'Old review');
  view.rerender(
    <SpeakerReview {...props} meetingId="new" report={{ ...report, job: 'new-job' }} />
  );
  expect(within(card('mic')).getByRole('combobox')).toHaveValue('');
  expect(within(card('mic')).getByRole('textbox')).toHaveValue('');
  expect(within(card('mic')).queryByRole('checkbox')).toBeNull();
  await act(async () => finish({ ...recognition, calibrationStatus: 'calibrated' }));
  expect(screen.queryByText('Suggested identity: Ana')).toBeNull();
  expect(screen.queryByText(i18n.t('speakers.calibrationReported'))).toBeNull();
});
it('reports unavailable suggestions and retries without changing identity', async () => {
  vi.mocked(library.recognition).mockRejectedValueOnce(new Error('suggestions offline'));
  render(<SpeakerReview {...props} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('suggestions offline');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Suggested identity: Ana')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(library.confirmSpeaker).not.toHaveBeenCalled();
});
it('plays one isolated representative excerpt from the correct track and skips competing turns', async () => {
  const onSeek = vi.fn();
  const value = {
    ...report,
    turns: [
      ...report.turns,
      { id: 'competing', track: 'mic', speaker: 'unknown-overlap', start_ms: 2000, end_ms: 3000 },
      { id: 'clean', track: 'mic', speaker: 'speaker-1', start_ms: 6000, end_ms: 26000 },
    ],
  };
  render(<SpeakerReview {...props} report={value} onSeek={onSeek} />);
  const mic = within(card('mic'));
  expect(mic.getAllByRole('button', { name: /Play excerpt/ })).toHaveLength(1);
  fireEvent.click(mic.getByRole('button', { name: /Play excerpt/ }));
  expect(onSeek).toHaveBeenCalledWith('mic', 6, 18);
});

it('keeps identity unknown when a proposed name has no compatible policy', async () => {
  vi.mocked(library.recognition).mockResolvedValue({
    ...recognition,
    calibrationStatus: 'uncalibrated',
  });
  render(<SpeakerReview {...props} />);
  expect(await screen.findByText(i18n.t('speakers.noCalibration'))).toBeInTheDocument();
  expect(screen.queryByText('Suggested identity: Ana')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Select person for review' })).toBeNull();
});

it('R3 does not refetch recognition for an unchanged job report object and keeps toggle accessible names stable', async () => {
  const excerpt = JSON.stringify(['mic', 1, 4]);
  const playback = {
    current: null as string | null,
    play: vi.fn(),
    stop: vi.fn(),
    nativePlay: vi.fn(),
  };
  const view = render(<SpeakerReview {...props} playback={playback} />);
  await screen.findByText('Suggested identity: Ana');
  const listen = within(card('mic')).getByRole('button', { name: /Play excerpt/ });
  const name = listen.getAttribute('aria-label');
  view.rerender(
    <SpeakerReview {...props} report={{ ...report }} playback={{ ...playback, current: excerpt }} />
  );
  expect(library.recognition).toHaveBeenCalledTimes(1);
  const playing = within(card('mic')).getByRole('button', { name: name! });
  expect(playing).toHaveAttribute('aria-pressed', 'true');
  expect(playing).toHaveTextContent('Pause excerpt');
});
