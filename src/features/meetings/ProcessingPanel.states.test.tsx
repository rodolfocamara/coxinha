import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { ProcessingPanel } from './ProcessingPanel';
import { library, type ProcessingDetail, type CaptureStatus } from './library';
vi.mock('./library', () => ({
  library: { processing: vi.fn(), recognition: vi.fn(), participantContext: vi.fn() },
}));
const empty: ProcessingDetail = { jobs: [], people: [], report: null };
const idle: CaptureStatus = { active: null, error: null };
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('en');
  vi.mocked(library.processing).mockResolvedValue(empty);
});
const props = {
  meetingId: 'm',
  closed: true,
  status: idle,
  onStatus: vi.fn(),
  onSeek: vi.fn(),
  view: 'people' as const,
};
it.each(['en', 'pt-BR'])(
  'shows empty voices and directs to Transcript in %s without exposing technical configuration',
  async (locale) => {
    await i18n.changeLanguage(locale);
    const onTranscript = vi.fn();
    render(<ProcessingPanel {...props} onTranscript={onTranscript} />);
    expect(await screen.findByText(i18n.t('speakers.empty'))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('library.processing.configFile'))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('speakers.openTranscript') }));
    expect(onTranscript).toHaveBeenCalledOnce();
  }
);
it('shows pending work and failed transcription as distinct actionable states', async () => {
  vi.mocked(library.processing).mockResolvedValueOnce({
    ...empty,
    jobs: [{ id: 'j', state: 'queued', attempts: 0, error: null }],
  });
  const view = render(<ProcessingPanel {...props} />);
  expect(await screen.findByText(i18n.t('speakers.pending'))).toBeInTheDocument();
  vi.mocked(library.processing).mockResolvedValue({
    ...empty,
    jobs: [{ id: 'j', state: 'failed', attempts: 1, error: 'failed engine' }],
  });
  view.rerender(
    <ProcessingPanel
      {...props}
      status={{ ...idle, processing: { meetingId: 'm', job: 'j', phase: 'done' } }}
    />
  );
  await waitFor(() => expect(library.processing).toHaveBeenCalledTimes(2));
  view.rerender(<ProcessingPanel {...props} />);
  expect(await screen.findByText(i18n.t('speakers.failed'))).toBeInTheDocument();
});
it('shows loading, unavailable and retry without retaining old report controls', async () => {
  let fail!: (reason: Error) => void;
  vi.mocked(library.processing).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      })
  );
  render(<ProcessingPanel {...props} />);
  expect(screen.getByText(i18n.t('speakers.loading'))).toBeInTheDocument();
  await act(async () => fail(new Error('read unavailable')));
  expect(screen.getByText(i18n.t('speakers.unavailable'))).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText(i18n.t('speakers.empty'))).toBeInTheDocument();
});
