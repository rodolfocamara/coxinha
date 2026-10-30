import { changeControl } from '../../test/changeControl';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { ProcessingPanel } from './ProcessingPanel';
import { library, type ProcessingDetail } from './library';
import { voiceCuration } from './voiceCuration';
vi.mock('./library', () => ({
  library: { processing: vi.fn(), recognition: vi.fn(), participantContext: vi.fn() },
}));
vi.mock('./voiceCuration', async (original) => ({
  ...(await original<typeof import('./voiceCuration')>()),
  voiceCuration: { candidates: vi.fn() },
}));
const data: ProcessingDetail = {
  jobs: [],
  people: [
    { id: 'uuid-ana-11111111', name: 'Ana' },
    { id: 'uuid-ana-22222222', name: 'Ana' },
  ],
  report: {
    job: 'job',
    segments: [],
    warnings: [],
    corrections: {},
    assignments: [
      {
        id: 'assignment',
        speaker: 'speaker-1',
        track: 'mic',
        person_id: 'uuid-ana-11111111',
        name: 'Ana',
        state: 'confirmed',
      },
    ],
    turns: [{ id: 'turn', track: 'mic', speaker: 'speaker-1', start_ms: 1000, end_ms: 2000 }],
  },
};
const playback = { current: null, play: vi.fn(), stop: vi.fn(), nativePlay: vi.fn() };
const props = {
  meetingId: 'm',
  closed: true,
  status: { active: null, error: null },
  onStatus: vi.fn(),
  onSeek: vi.fn(),
  playback,
};
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('en');
  vi.mocked(library.processing).mockResolvedValue(data);
  vi.mocked(library.recognition).mockResolvedValue({
    job: 'job',
    calibrationStatus: 'uncalibrated',
    profileGeneration: 0,
    speakers: [],
  });
  vi.mocked(library.participantContext).mockResolvedValue([]);
  vi.mocked(voiceCuration.candidates).mockResolvedValue({
    job: 'job',
    meetingId: 'm',
    track: 'mic',
    speaker: 'speaker-1',
    assignmentId: 'assignment',
    personId: 'uuid-ana-11111111',
    assignmentRevision: 1,
    profileGeneration: 1,
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
});
it('R3 preserves person, human evidence and unsubmitted sample drafts across transcript hops and resets on job/meeting changes', async () => {
  const view = render(<ProcessingPanel {...props} view="people" />);
  await screen.findByText('Confirmed identity: Ana');
  changeControl(screen.getByRole('combobox'), { target: { value: 'uuid-ana-22222222' } });
  changeControl(screen.getByRole('textbox', { name: 'How did you verify this identity?' }), {
    target: { value: 'Unsubmitted human evidence' },
  });
  fireEvent.click(screen.getByText('Choose voice samples to remember', { selector: 'summary' }));
  const checkbox = await screen.findByRole('checkbox');
  fireEvent.click(checkbox);
  changeControl(
    screen.getByRole('textbox', { name: 'Consent and review for these selected samples' }),
    { target: { value: 'Unsubmitted consent review' } }
  );
  view.rerender(<ProcessingPanel {...props} view="transcript" />);
  expect(screen.queryByRole('textbox', { name: 'How did you verify this identity?' })).toBeNull();
  view.rerender(<ProcessingPanel {...props} view="people" />);
  expect(screen.getByRole('combobox')).toHaveValue('uuid-ana-22222222');
  expect(screen.getByRole('textbox', { name: 'How did you verify this identity?' })).toHaveValue(
    'Unsubmitted human evidence'
  );
  expect(screen.getByRole('checkbox')).toBeChecked();
  expect(
    screen.getByRole('textbox', { name: 'Consent and review for these selected samples' })
  ).toHaveValue('Unsubmitted consent review');
  expect(library.recognition).toHaveBeenCalledTimes(1);
  vi.mocked(library.processing).mockResolvedValue({
    ...data,
    report: { ...data.report!, job: 'new-job' },
  });
  view.rerender(
    <ProcessingPanel
      {...props}
      view="people"
      status={{ ...props.status, processing: { meetingId: 'm', job: 'new-job', phase: 'done' } }}
    />
  );
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue(''));
  expect(screen.getByRole('textbox', { name: 'How did you verify this identity?' })).toHaveValue(
    ''
  );
  expect(screen.queryByRole('checkbox')).toBeNull();
  changeControl(screen.getByRole('combobox'), { target: { value: 'uuid-ana-22222222' } });
  view.rerender(<ProcessingPanel {...props} meetingId="new-meeting" view="people" />);
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue(''));
});
it('R3 does not stop a fresh initial-report gesture and stops only when the actual report job changes', async () => {
  const view = render(<ProcessingPanel {...props} view="people" />);
  const listen = await screen.findByRole('button', { name: /Play excerpt/ });
  fireEvent.click(listen);
  await waitFor(() => expect(playback.play).toHaveBeenCalledOnce());
  expect(playback.stop).not.toHaveBeenCalled();
  vi.mocked(library.processing).mockResolvedValue({
    ...data,
    report: { ...data.report!, job: 'other' },
  });
  view.rerender(
    <ProcessingPanel
      {...props}
      view="people"
      status={{ ...props.status, processing: { meetingId: 'm', job: 'other', phase: 'done' } }}
    />
  );
  await waitFor(() => expect(playback.stop).toHaveBeenCalledTimes(1));
});
it('R3 disambiguates homonyms without changing their stable person IDs', async () => {
  render(<ProcessingPanel {...props} view="people" />);
  const selector = await screen.findByRole('combobox');
  fireEvent.keyDown(selector, { key: 'ArrowDown' });
  const options = screen.getAllByRole('option');
  expect(options[1]).toHaveTextContent('Ana (11111111)');
  expect(options[2]).toHaveTextContent('Ana (22222222)');
  expect(options[1]).toHaveAttribute('data-value', 'uuid-ana-11111111');
  expect(options[2]).toHaveAttribute('data-value', 'uuid-ana-22222222');
});
