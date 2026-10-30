import { changeControl } from '../../test/changeControl';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { SpeakerCard } from './SpeakerCard';
import { library, type ProcessingReport } from './library';
import { voiceCuration } from './voiceCuration';
vi.mock('./library', () => ({ library: { confirmSpeaker: vi.fn(), revokeAssignment: vi.fn() } }));
vi.mock('./voiceCuration', async (original) => ({
  ...(await original<typeof import('./voiceCuration')>()),
  voiceCuration: { candidates: vi.fn(), enroll: vi.fn() },
}));
const report: ProcessingReport = {
  job: 'job',
  segments: [],
  turns: [{ id: 'turn', track: 'mic', speaker: 'speaker-1', start_ms: 1000, end_ms: 2000 }],
  corrections: {},
  warnings: [],
  assignments: [
    {
      id: 'assignment',
      track: 'mic',
      speaker: 'speaker-1',
      person_id: 'ana-11111111',
      name: 'Ana',
      state: 'confirmed',
    },
  ],
};
const props = {
  meetingId: 'm',
  track: 'mic',
  speaker: 'speaker-1',
  report,
  curationVersion: report,
  people: [
    { id: 'ana-11111111', name: 'Ana' },
    { id: 'ana-22222222', name: 'Ana' },
  ],
  recognition: null,
  disabled: false,
  act: async (action: () => Promise<unknown>) => {
    await action();
  },
  onSeek: vi.fn(),
};
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('en');
  vi.mocked(voiceCuration.candidates).mockResolvedValue({
    job: 'job',
    meetingId: 'm',
    track: 'mic',
    speaker: 'speaker-1',
    profileGeneration: 1,
    assignmentId: 'assignment',
    personId: 'ana-11111111',
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
  vi.mocked(voiceCuration.enroll).mockResolvedValue({
    sampleIds: ['sample'],
    profileGeneration: 2,
  });
});
function choose(person: string) {
  changeControl(screen.getByRole('combobox'), { target: { value: person } });
  changeControl(screen.getByRole('textbox', { name: i18n.t('speakers.decisionOrigin') }), {
    target: { value: 'Human identity review' },
  });
}
for (const locale of ['en', 'pt-BR'])
  it(`R4 unchanged confirmed UUID never sends confirmation IPC in ${locale}`, async () => {
    await i18n.changeLanguage(locale);
    render(<SpeakerCard {...props} />);
    choose('ana-11111111');
    const button = screen.getByRole('button', {
      name: i18n.t('library.processing.correctIdentity'),
    });
    fireEvent.click(button);
    expect(library.confirmSpeaker).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
    expect(screen.getByText(i18n.t('speakers.alreadyConfirmed'))).toBeVisible();
  });
it('R4 permits a genuine correction to a different UUID even with the same display name', async () => {
  render(<SpeakerCard {...props} />);
  choose('ana-22222222');
  const button = screen.getByRole('button', { name: 'Correct identity' });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  await waitFor(() =>
    expect(library.confirmSpeaker).toHaveBeenCalledWith(
      'job',
      'speaker-1',
      'ana-22222222',
      'Human identity review',
      false,
      'mic'
    )
  );
  expect(screen.queryByText(i18n.t('speakers.alreadyConfirmed'))).toBeNull();
});
it('R4 preserves initial explicit confirmation when no confirmed assignment exists', async () => {
  render(<SpeakerCard {...props} report={{ ...report, assignments: [] }} />);
  choose('ana-11111111');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm identity' }));
  await waitFor(() =>
    expect(library.confirmSpeaker).toHaveBeenCalledWith(
      'job',
      'speaker-1',
      'ana-11111111',
      'Human identity review',
      false,
      'mic'
    )
  );
});
it('R4 leaves selected enrollment and assignment revocation usable while unchanged confirmation is blocked', async () => {
  render(<SpeakerCard {...props} />);
  choose('ana-11111111');
  expect(screen.getByRole('button', { name: 'Correct identity' })).toBeDisabled();
  fireEvent.click(screen.getByText('Choose voice samples to remember', { selector: 'summary' }));
  fireEvent.click(await screen.findByRole('checkbox'));
  changeControl(
    screen.getByRole('textbox', { name: 'Consent and review for these selected samples' }),
    { target: { value: 'Consent allows reuse; selected segment reviewed' } }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remember selected samples (1)' }));
  await waitFor(() =>
    expect(voiceCuration.enroll).toHaveBeenCalledWith({
      job: 'job',
      track: 'mic',
      speaker: 'speaker-1',
      assignmentId: 'assignment',
      personId: 'ana-11111111',
      expectedAssignmentRevision: 7,
      turnIds: ['turn'],
      humanOrigin: 'Consent allows reuse; selected segment reviewed',
    })
  );
  expect(library.confirmSpeaker).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Revoke identity and voice contributions' }));
  await waitFor(() =>
    expect(library.revokeAssignment).toHaveBeenCalledWith('assignment', 'Human identity review')
  );
  expect(library.confirmSpeaker).not.toHaveBeenCalled();
});
