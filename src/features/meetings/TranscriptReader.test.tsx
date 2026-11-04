import { changeControl } from '../../test/changeControl';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { ProcessingPanel } from './ProcessingPanel';
import { library, type ProcessingDetail, type ProcessingReport } from './library';

vi.mock('./library', () => ({
  library: {
    processing: vi.fn(),
    editSegment: vi.fn(),
    recognition: vi.fn().mockResolvedValue({ calibrationStatus: 'uncalibrated', speakers: [] }),
    participantContext: vi.fn().mockResolvedValue([]),
  },
}));

const line = (id: string, speaker: string | null, start: number, text: string) => ({
  id,
  track: 'output',
  speaker,
  start_ms: start * 1000,
  end_ms: start * 1000 + 900,
  text,
});
const report: ProcessingReport = {
  job: 'job',
  warnings: [],
  corrections: { b: 'O headcount fica para Q1.' },
  assignments: [
    {
      id: 'a',
      track: 'output',
      speaker: 'speaker-1',
      person_id: 'p',
      state: 'confirmed',
      name: 'Rosana',
    },
  ],
  turns: [
    { id: 't1', track: 'output', speaker: 'speaker-1', start_ms: 0, end_ms: 9000 },
    { id: 't2', track: 'output', speaker: 'speaker-2', start_ms: 10000, end_ms: 19000 },
  ],
  segments: [
    line('a', 'speaker-1', 1, 'Vamos falar do headcount.'),
    line('b', 'speaker-1', 5, 'texto da máquina'),
    line('c', 'speaker-2', 12, 'Sem headcount extra não dá.'),
    line('d', null, 20, 'Alguém fora do microfone.'),
  ],
};
const withReport: ProcessingDetail = {
  jobs: [{ id: 'job', state: 'succeeded', attempts: 1, error: null }],
  people: [],
  report,
};
const props = {
  meetingId: 'm',
  closed: true,
  status: { active: null, error: null },
  onStatus: vi.fn(),
  view: 'transcript' as const,
};

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
  vi.mocked(library.processing).mockResolvedValue(withReport);
  vi.mocked(library.editSegment).mockResolvedValue(undefined as never);
});

it('reads as speaker turns with a time that seeks the audio', async () => {
  const onSeek = vi.fn();
  render(<ProcessingPanel {...props} onSeek={onSeek} />);
  const turns = await screen.findAllByRole('listitem');
  expect(turns.map((t) => t.getAttribute('aria-label'))).toEqual([
    'Rosana',
    'Speaker 2',
    i18n.t('library.processing.anonymous'),
  ]);
  expect(within(turns[0]).getAllByRole('button', { name: /Play from/ })).toHaveLength(2);
  expect(screen.getByText(/2 speakers/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Play from 0:12, Speaker 2' }));
  expect(onSeek).toHaveBeenCalledWith('output', 12);
});

it('finds across lines, counts, wraps and marks the current match', async () => {
  render(<ProcessingPanel {...props} onSeek={vi.fn()} />);
  const find = await screen.findByRole('searchbox', { name: 'Search the transcript' });
  changeControl(find, { target: { value: 'HEADCOUNT' } });
  expect(screen.getByText('1/3')).toBeInTheDocument();
  const marks = () => [...document.querySelectorAll('mark')];
  expect(marks().map((m) => m.textContent)).toEqual(['headcount', 'headcount', 'headcount']);
  expect(marks()[0]).toHaveAttribute('data-current');
  fireEvent.keyDown(find, { key: 'Enter' });
  expect(screen.getByText('2/3')).toBeInTheDocument();
  expect(marks()[1]).toHaveAttribute('data-current');
  fireEvent.keyDown(find, { key: 'Enter', shiftKey: true });
  fireEvent.keyDown(find, { key: 'Enter', shiftKey: true });
  expect(screen.getByText('3/3')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
  expect(screen.getByText('1/3')).toBeInTheDocument();
  changeControl(find, { target: { value: 'nada disso' } });
  expect(screen.getByText('No matches')).toBeInTheDocument();
});

it('opens found at the universal search text and scrolls to it (spec 0122)', async () => {
  const scrolled = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
  render(<ProcessingPanel {...props} onSeek={vi.fn()} find="sem headcount" />);
  const find = await screen.findByRole('searchbox', { name: 'Search the transcript' });
  expect(find).toHaveValue('sem headcount');
  expect(screen.getByText('1/1')).toBeInTheDocument();
  const current = document.querySelector('mark[data-current]');
  expect(current).toHaveTextContent('Sem headcount');
  await waitFor(() => expect(scrolled).toHaveBeenCalled());
});

it('opens a correction for one line, cancels with Escape and saves', async () => {
  render(<ProcessingPanel {...props} onSeek={vi.fn()} />);
  await screen.findByText('Vamos falar do headcount.');
  expect(screen.queryByLabelText('Corrected text')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Correct the line at 0:01' }));
  const box = screen.getByLabelText('Corrected text');
  expect(screen.getAllByLabelText('Corrected text')).toHaveLength(1);
  fireEvent.keyDown(box, { key: 'Escape' });
  expect(screen.queryByLabelText('Corrected text')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Correct the line at 0:01' }));
  changeControl(screen.getByLabelText('Corrected text'), {
    target: { value: 'Vamos falar do headcount de 2027.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(library.editSegment).toHaveBeenCalledWith(
      'm',
      'job:a',
      'Vamos falar do headcount de 2027.'
    )
  );
  await waitFor(() => expect(screen.queryByLabelText('Corrected text')).toBeNull());
});

it('keeps processing collapsed with a transcript and open without one', async () => {
  const view = render(<ProcessingPanel {...props} onSeek={vi.fn()} />);
  await screen.findByText('Vamos falar do headcount.');
  const summary = () => screen.getByText('Processing', { selector: 'summary' });
  expect(summary().closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText('Open local configuration file')).not.toBeVisible();
  view.unmount();
  vi.mocked(library.processing).mockResolvedValue({ jobs: [], people: [], report: null });
  render(<ProcessingPanel {...props} onSeek={vi.fn()} />);
  await waitFor(() => expect(library.processing).toHaveBeenCalledTimes(2));
  expect(summary().closest('details')).toHaveAttribute('open');
  expect(screen.getByText('Open local configuration file')).toBeVisible();
  expect(screen.queryByRole('searchbox')).toBeNull();
});
