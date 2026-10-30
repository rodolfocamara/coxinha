import { changeControl } from '../../test/changeControl';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { ProcessingPanel } from './ProcessingPanel';
import { library, type ProcessingDetail } from './library';
import { voiceComparison, voiceCuration } from './voiceCuration';
vi.mock('./library', () => ({
  library: {
    processing: vi.fn(),
    recognition: vi.fn(),
    participantContext: vi.fn(),
    confirmSpeaker: vi.fn(),
    revokeAssignment: vi.fn(),
  },
}));
vi.mock('./voiceCuration', async (original) => ({
  ...(await original<typeof import('./voiceCuration')>()),
  voiceCuration: {
    candidates: vi.fn(),
    enroll: vi.fn(),
    profilesPage: vi.fn(),
    samplesPage: vi.fn(),
    revoke: vi.fn(),
  },
  voiceComparison: vi.fn(),
}));
const data: ProcessingDetail = {
  jobs: [],
  people: [{ id: 'ana', name: 'Ana' }],
  report: {
    job: 'job',
    warnings: [],
    corrections: {},
    segments: [],
    turns: [{ id: 'turn', track: 'output', speaker: 'speaker-1', start_ms: 1000, end_ms: 2000 }],
    assignments: [
      {
        id: 'a',
        person_id: 'ana',
        state: 'confirmed',
        track: 'output',
        speaker: 'speaker-1',
        name: 'Ana',
      },
    ],
  },
};
const space = {
  model: 'model',
  revision: 'r1',
  model_hash: 'hash',
  preprocessing: 'p1',
  dimension: 2,
};
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('en');
  vi.mocked(library.processing).mockResolvedValue(data);
  vi.mocked(library.recognition).mockResolvedValue({
    job: 'job',
    calibrationStatus: 'uncalibrated',
    profileGeneration: 1,
    speakers: [],
  });
  vi.mocked(library.participantContext).mockResolvedValue([]);
  vi.mocked(voiceCuration.candidates).mockResolvedValue({
    job: 'job',
    meetingId: 'm',
    track: 'output',
    speaker: 'speaker-1',
    profileGeneration: 1,
    assignmentId: 'a',
    personId: 'ana',
    assignmentRevision: 7,
    quality: { noise: 'unmeasured', echo: 'unmeasured', otherTrack: 'unmeasured' },
    turns: [
      {
        turnId: 'turn',
        startMs: 1000,
        endMs: 2000,
        eligible: true,
        reasons: [],
        activeSampleCount: 0,
      },
    ],
  });
  vi.mocked(voiceCuration.profilesPage).mockResolvedValue({
    profileGeneration: 1,
    profiles: [],
    nextCursor: null,
    scannedRows: 0,
  });
  vi.mocked(voiceComparison).mockResolvedValue({
    job: 'job',
    experimental: true,
    profileGeneration: 1,
    speakers: [
      {
        track: 'output',
        speaker: 'speaker-1',
        queryStatus: 'eligible',
        spaces: [
          {
            space,
            status: 'candidates',
            invalidHistorySamples: 0,
            candidates: [
              {
                personId: 'ana',
                name: 'Ana',
                meanCosine: 0.7,
                maxCosine: 0.8,
                supportTurns: 1,
                supportDurationMs: 1000,
                activeSamples: 1,
                turnDetailsTruncated: false,
                turns: [],
              },
            ],
          },
        ],
      },
    ],
  });
  vi.mocked(voiceCuration.enroll).mockResolvedValue({
    sampleIds: ['sample'],
    profileGeneration: 2,
  });
});
it('enrolls selected samples without reconfirmation, refreshes private evidence and never preselects comparison identities', async () => {
  render(
    <ProcessingPanel
      meetingId="m"
      closed
      status={{ active: null, error: null }}
      onStatus={vi.fn()}
      onSeek={vi.fn()}
      view="people"
    />
  );
  await screen.findByText('Confirmed identity: Ana');
  const selector = screen.getByRole('combobox');
  expect(selector).toHaveValue('');
  fireEvent.click(
    screen.getByText('Experimental cross-meeting comparison', { selector: 'summary' })
  );
  expect(await screen.findByText('Ana · ana')).toBeInTheDocument();
  expect(selector).toHaveValue('');
  expect(library.confirmSpeaker).not.toHaveBeenCalled();
  expect(voiceCuration.enroll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Private voice memory', { selector: 'summary' }));
  await screen.findByText('No private voice profiles yet.');
  fireEvent.click(screen.getByText('Choose voice samples to remember', { selector: 'summary' }));
  const choice = await screen.findByRole('checkbox');
  expect(choice).not.toBeChecked();
  fireEvent.click(choice);
  changeControl(
    screen.getByRole('textbox', { name: 'Consent and review for these selected samples' }),
    { target: { value: 'Reuse consent and reviewed audio' } }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remember selected samples (1)' }));
  await waitFor(() =>
    expect(voiceCuration.enroll).toHaveBeenCalledWith({
      job: 'job',
      track: 'output',
      speaker: 'speaker-1',
      assignmentId: 'a',
      personId: 'ana',
      expectedAssignmentRevision: 7,
      turnIds: ['turn'],
      humanOrigin: 'Reuse consent and reviewed audio',
    })
  );
  expect(library.confirmSpeaker).not.toHaveBeenCalled();
  await waitFor(() => expect(library.processing).toHaveBeenCalledTimes(2));
  expect(voiceCuration.profilesPage).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(i18n.t('voiceCuration.staleView'))).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('voiceCuration.restartProfiles') }));
  await waitFor(() => expect(voiceCuration.profilesPage).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(vi.mocked(voiceComparison).mock.calls.length).toBeGreaterThanOrEqual(2)
  );
  expect(screen.getByRole('combobox')).toHaveValue('');
  await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked());
});
it('keeps one concise recognition status and discloses technical details below the primary identity controls', async () => {
  render(
    <ProcessingPanel
      meetingId="m"
      closed
      status={{ active: null, error: null }}
      onStatus={vi.fn()}
      onSeek={vi.fn()}
      view="people"
    />
  );
  await screen.findByText('Confirmed identity: Ana');
  await screen.findByText(i18n.t('speakers.noCalibration'));
  expect(screen.getAllByText(i18n.t('speakers.noCalibration'))).toHaveLength(1);
  expect(screen.queryByRole('heading', { name: 'People & voices' })).toBeNull();
  expect(screen.queryByText('Voice identity unknown')).toBeNull();
  const details = screen
    .getByText('Recognition and transcription details', { selector: 'summary' })
    .closest('details')!;
  expect(details).not.toHaveAttribute('open');
  expect(within(details).getByText(i18n.t('library.processing.unknown'))).not.toBeVisible();
  expect(screen.getByText(i18n.t('voiceCuration.confirmScope'))).toBeVisible();
  expect(screen.getByRole('button', { name: 'Correct identity' })).toBeVisible();
  fireEvent.click(
    within(details).getByText('Recognition and transcription details', { selector: 'summary' })
  );
  expect(within(details).getByText(i18n.t('library.processing.unknown'))).toBeVisible();
});
