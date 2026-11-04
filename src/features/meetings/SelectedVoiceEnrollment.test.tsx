import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { SelectedVoiceEnrollment } from './SelectedVoiceEnrollment';
import { voiceCuration, type EnrollmentCandidates } from './voiceCuration';
import type { ProcessingReport } from './library';
vi.mock('./voiceCuration', async (original) => ({
  ...(await original<typeof import('./voiceCuration')>()),
  voiceCuration: { candidates: vi.fn(), enroll: vi.fn() },
}));
const report: ProcessingReport = {
  job: 'job',
  assignments: [],
  turns: [],
  segments: [],
  corrections: {},
  warnings: [],
};
const assignment = {
  id: 'assignment',
  person_id: 'person',
  state: 'confirmed',
  track: 'output',
  speaker: 'speaker-1',
  name: 'Ana',
};
const data: EnrollmentCandidates = {
  job: 'job',
  meetingId: 'm',
  track: 'output',
  speaker: 'speaker-1',
  profileGeneration: 1,
  assignmentId: 'assignment',
  personId: 'person',
  assignmentRevision: 3,
  quality: { noise: 'unmeasured', echo: 'unmeasured', otherTrack: 'unmeasured' },
  turns: [
    { turnId: 'a', startMs: 1000, endMs: 2000, eligible: true, reasons: [], activeSampleCount: 0 },
    { turnId: 'b', startMs: 3000, endMs: 4000, eligible: true, reasons: [], activeSampleCount: 0 },
    {
      turnId: 'overlap',
      startMs: 5000,
      endMs: 6000,
      eligible: false,
      reasons: ['same_track_overlap'],
      activeSampleCount: 0,
    },
    {
      turnId: 'used',
      startMs: 7000,
      endMs: 8000,
      eligible: false,
      reasons: ['already_enrolled'],
      activeSampleCount: 1,
    },
  ],
};
const props = {
  meetingId: 'm',
  track: 'output',
  speaker: 'speaker-1',
  report,
  assignment,
  disabled: false,
  version: report,
  act: async (action: () => Promise<unknown>) => {
    await action();
  },
};
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('en');
  vi.mocked(voiceCuration.candidates).mockResolvedValue(data);
  vi.mocked(voiceCuration.enroll).mockResolvedValue({
    sampleIds: ['sample'],
    profileGeneration: 2,
  });
});
async function open() {
  fireEvent.click(screen.getByText(i18n.t('voiceCuration.chooseSamples'), { selector: 'summary' }));
  await screen.findAllByRole('checkbox');
}
for (const locale of ['en', 'pt-BR'])
  it(`requires explicit segment selection and exact assignment revision in ${locale}`, async () => {
    await i18n.changeLanguage(locale);
    render(<SelectedVoiceEnrollment {...props} />);
    expect(voiceCuration.candidates).not.toHaveBeenCalled();
    await open();
    const boxes = screen.getAllByRole('checkbox');
    boxes.forEach((box) => expect(box).not.toBeChecked());
    expect(boxes[2]).toBeDisabled();
    expect(boxes[3]).toBeDisabled();
    expect(screen.getByText(i18n.t('voiceCuration.unmeasured'))).toBeInTheDocument();
    const submit = () => screen.getByRole('button', { name: /\(\d+\)/ });
    expect(submit()).toBeDisabled();
    fireEvent.click(boxes[1]);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Consent permits reuse; reviewed this sample' },
    });
    // Under parallel load the selection can commit a render after the click event.
    await waitFor(() => expect(screen.getAllByRole('checkbox')[1]).toBeChecked());
    await waitFor(() => expect(submit()).toBeEnabled());
    fireEvent.click(submit());
    await waitFor(() =>
      expect(voiceCuration.enroll).toHaveBeenCalledWith({
        job: 'job',
        track: 'output',
        speaker: 'speaker-1',
        assignmentId: 'assignment',
        personId: 'person',
        expectedAssignmentRevision: 3,
        turnIds: ['b'],
        humanOrigin: 'Consent permits reuse; reviewed this sample',
      })
    );
    await waitFor(() => expect(voiceCuration.candidates).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole('checkbox').some((box) => (box as HTMLInputElement).checked)).toBe(
      false
    );
  });
it('clears selections on revision refresh, rejects foreign assignment lists and ignores stale fetches', async () => {
  const view = render(<SelectedVoiceEnrollment {...props} />);
  await open();
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  vi.mocked(voiceCuration.candidates).mockResolvedValue({ ...data, assignmentRevision: 4 });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh voice evidence' }));
  await waitFor(() => expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked());
  let finish!: (value: EnrollmentCandidates) => void;
  vi.mocked(voiceCuration.candidates).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh voice evidence' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  vi.mocked(voiceCuration.candidates).mockResolvedValue({
    ...data,
    assignmentId: 'foreign',
    assignmentRevision: 10,
  });
  view.rerender(<SelectedVoiceEnrollment {...props} version={{ changed: true }} />);
  expect(await screen.findByText(i18n.t('voiceCuration.staleAssignment'))).toBeInTheDocument();
  await act(async () => finish(data));
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(voiceCuration.enroll).not.toHaveBeenCalled();
});
it('guards duplicate enrollment, surfaces stale-revision failure and refetches without reconfirming', async () => {
  let fail!: (e: Error) => void;
  vi.mocked(voiceCuration.enroll).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      })
  );
  render(<SelectedVoiceEnrollment {...props} />);
  await open();
  fireEvent.click(screen.getAllByRole('checkbox')[0]);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Explicit consent' } });
  const submit = screen.getByRole('button', { name: 'Remember selected samples (1)' });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(voiceCuration.enroll).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error('assignment revision changed')));
  expect(await screen.findByRole('alert')).toHaveTextContent('assignment revision changed');
  await waitFor(() => expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked());
  expect(voiceCuration.candidates).toHaveBeenCalledTimes(2);
});
it('bounds selected-turn previews on the exact current granted track', async () => {
  const playback = { current: null, play: vi.fn(), stop: vi.fn(), nativePlay: vi.fn() };
  render(<SelectedVoiceEnrollment {...props} playback={playback} />);
  await open();
  expect(screen.getAllByRole('button', { name: /Play excerpt/ })).toHaveLength(4);
  fireEvent.click(screen.getAllByRole('button', { name: /Play excerpt/ })[1]);
  expect(playback.play).toHaveBeenCalledWith({ track: 'output', start: 3, end: 4 });
});
