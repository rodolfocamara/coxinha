import { changeControl } from '../../test/changeControl';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../lib/i18n';
import { ProcessingPanel } from './ProcessingPanel';
import { library } from './library';
vi.mock('./library', () => ({
  library: {
    processing: vi.fn(),
    process: vi.fn(),
    recognition: vi.fn().mockResolvedValue({ calibrationStatus: 'uncalibrated', speakers: [] }),
    participantContext: vi.fn().mockResolvedValue([]),
    setParticipantContext: vi.fn(),
    confirmSpeaker: vi.fn(),
    createPerson: vi.fn(),
  },
}));
const empty = { jobs: [], report: null, people: [] };
const idle = { active: null, error: null };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(library.processing).mockResolvedValue(empty);
});
describe('processing panel', () => {
  it('handles partial and malformed model previews without crashing', async () => {
    render(
      <ProcessingPanel meetingId="m1" closed status={idle} onStatus={vi.fn()} onSeek={vi.fn()} />
    );
    const input = screen.getAllByRole('textbox', { hidden: true })[0];
    for (const value of [
      'null',
      '{"models":null}',
      '{"models":[null]}',
      '{"models":{"bad":null,"object":{"path":{}}}}',
    ]) {
      changeControl(input, { target: { value } });
      expect(input).toHaveValue(value);
    }
    changeControl(input, {
      target: {
        value:
          '{"models":{"whisper":{"path":"local.bin","sha256":"hash","provenance":"local source"}}}',
      },
    });
    expect(screen.getByText('local.bin')).toBeInTheDocument();
    await waitFor(() => expect(library.processing).toHaveBeenCalled());
  });
  it('releases action busy state when processing status changes during launch', async () => {
    const onStatus = vi.fn();
    vi.mocked(library.process).mockResolvedValue(idle);
    let finish: (() => void) | undefined;
    vi.mocked(library.processing)
      .mockResolvedValueOnce(empty)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = () => resolve(empty);
          })
      )
      .mockResolvedValue(empty);
    const props = { meetingId: 'm1', closed: true, onStatus, onSeek: vi.fn() };
    const view = render(<ProcessingPanel {...props} status={idle} />);
    await waitFor(() => expect(library.processing).toHaveBeenCalledTimes(1));
    changeControl(screen.getAllByRole('textbox', { hidden: true })[0], {
      target: { value: '{}' },
    });
    const launch = screen.getByRole('button');
    fireEvent.click(launch);
    await waitFor(() => expect(onStatus).toHaveBeenCalled());
    view.rerender(
      <ProcessingPanel
        {...props}
        status={{ ...idle, processing: { phase: 'running', job: 'job1', meetingId: 'm1' } }}
      />
    );
    await waitFor(() => expect(library.processing).toHaveBeenCalledTimes(3));
    finish?.();
    view.rerender(<ProcessingPanel {...props} status={idle} />);
    await waitFor(() => expect(launch).toBeEnabled());
  });
  it('selects historical jobs and shows corrections separately from machine output', async () => {
    vi.mocked(library.processing).mockResolvedValue({
      jobs: ['old-job', 'new-job'].map((id) => ({
        id,
        state: 'succeeded',
        attempts: 1,
        error: null,
      })),
      people: [],
      report: {
        job: 'new-job',
        turns: [],
        warnings: [],
        assignments: [],
        corrections: { segment: 'Human corrected wording' },
        segments: [
          {
            id: 'segment',
            track: 'mic',
            start_ms: 1000,
            end_ms: 2000,
            text: 'Original machine wording',
            speaker: null,
          },
        ],
      },
    });
    render(
      <ProcessingPanel meetingId="m1" closed status={idle} onStatus={vi.fn()} onSeek={vi.fn()} />
    );
    expect(await screen.findByText('Original machine wording')).toBeInTheDocument();
    expect(screen.getAllByText(/Human corrected wording/).length).toBeGreaterThan(0);
    const versions = screen.getAllByRole('combobox')[0];
    changeControl(versions, { target: { value: 'old-job' } });
    await waitFor(() => expect(library.processing).toHaveBeenLastCalledWith('m1', 'old-job'));
    expect(await screen.findByText('Original machine wording')).toBeInTheDocument();
  });
  it('offers voice turn playback before confirmation and labels mapped text with a confirmed name', async () => {
    vi.mocked(library.processing).mockResolvedValue({
      jobs: [],
      people: [],
      report: {
        job: 'job',
        warnings: [
          'Experimental anonymous clustering; similarity thresholds are parameters, not calibrated confidence. Overlap and ambiguous speech retain unknown attribution.',
          'Native diagnostic detail',
        ],
        corrections: {},
        assignments: [
          {
            id: 'a',
            track: 'output',
            speaker: 'speaker-1',
            person_id: 'p',
            state: 'confirmed',
            name: 'Ana',
          },
        ],
        turns: [
          { id: 'turn', track: 'output', start_ms: 1250, end_ms: 3250, speaker: 'speaker-1' },
        ],
        segments: [
          {
            id: 'segment',
            track: 'output',
            start_ms: 1500,
            end_ms: 2000,
            text: 'Hello',
            speaker: 'speaker-1',
          },
        ],
      },
    });
    const onSeek = vi.fn();
    render(
      <ProcessingPanel meetingId="m1" closed status={idle} onStatus={vi.fn()} onSeek={onSeek} />
    );
    const listen = await screen.findByRole('button', { name: /Play excerpt \/ replay/ });
    expect(screen.getByText(/Experimental speaker grouping/)).toBeInTheDocument();
    expect(screen.getByText('Native diagnostic detail')).toBeInTheDocument();
    expect(listen).toHaveTextContent('0:01–0:03');
    fireEvent.click(listen);
    expect(onSeek).toHaveBeenCalledWith('output', 1.25, 3.25);
    expect(screen.getByRole('button', { name: /0:01 · Ana/ })).toBeInTheDocument();
  });
  it('keeps raw configuration and model metadata collapsed by default', () => {
    render(
      <ProcessingPanel meetingId="m1" closed status={idle} onStatus={vi.fn()} onSeek={vi.fn()} />
    );
    const summary = screen.getByText('Advanced configuration');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('Open local configuration file')).toBeVisible();
    expect(screen.getByRole('textbox').closest('details')).toBe(summary.closest('details'));
  });
});
it('refreshes a persisted name after a command follow-up fails without opting into enrollment', async () => {
  const report = {
    job: 'partial-job',
    warnings: [],
    corrections: {},
    segments: [],
    assignments: [],
    turns: [{ id: 'turn', track: 'imported', speaker: 'speaker-1', start_ms: 0, end_ms: 1000 }],
  };
  const data = { jobs: [], people: [{ id: 'person', name: 'Ana' }], report };
  vi.mocked(library.processing)
    .mockResolvedValueOnce(data)
    .mockResolvedValue({
      ...data,
      report: {
        ...report,
        assignments: [
          {
            id: 'assignment',
            track: 'imported',
            speaker: 'speaker-1',
            person_id: 'person',
            state: 'confirmed',
            name: 'Ana',
          },
        ],
      },
    });
  vi.mocked(library.confirmSpeaker).mockRejectedValue(
    new Error('confirmation saved; command follow-up failed')
  );
  render(
    <ProcessingPanel meetingId="partial" closed status={idle} onStatus={vi.fn()} onSeek={vi.fn()} />
  );
  changeControl(await screen.findByLabelText('Person to confirm'), {
    target: { value: 'person' },
  });
  changeControl(screen.getByLabelText(/How did you verify this identity\?/), {
    target: { value: 'review' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm identity' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'confirmation saved; command follow-up failed'
  );
  await screen.findByText('Confirmed identity: Ana');
  expect(screen.queryByRole('checkbox')).toBeNull();
});
