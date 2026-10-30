import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import '../../lib/i18n';
import { library, type ParticipantCandidate } from './library';
import { ParticipantContext } from './ParticipantContext';
vi.mock('./library', () => ({
  library: { participantContext: vi.fn(), setParticipantContext: vi.fn() },
}));
beforeEach(() => vi.clearAllMocks());
it('isolates a pending save and pending load when changing meetings', async () => {
  let finishSave!: (rows: ParticipantCandidate[]) => void;
  let finishLoad!: (rows: ParticipantCandidate[]) => void;
  vi.mocked(library.participantContext)
    .mockResolvedValueOnce([{ name: 'Candidate A', email: null }])
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLoad = resolve;
        })
    );
  vi.mocked(library.setParticipantContext).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      })
  );
  const props = { disabled: false, onSelect: vi.fn() };
  const view = render(<ParticipantContext {...props} meetingId="A" />);
  await screen.findByDisplayValue('Candidate A');
  fireEvent.click(screen.getByRole('button', { name: 'Save local candidates' }));
  view.rerender(<ParticipantContext {...props} meetingId="B" />);
  expect(screen.queryByDisplayValue('Candidate A')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save local candidates' })).toBeDisabled();
  await act(async () => {
    finishSave([{ name: 'Late A', email: null }]);
  });
  expect(screen.queryByDisplayValue('Late A')).not.toBeInTheDocument();
  await act(async () => {
    finishLoad([{ name: 'Candidate B', email: null }]);
  });
  expect(screen.getByDisplayValue('Candidate B')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save local candidates' })).toBeEnabled();
});
it('allows retrying a failed context load without enabling edits prematurely', async () => {
  vi.mocked(library.participantContext)
    .mockRejectedValueOnce(new Error('context unavailable'))
    .mockResolvedValueOnce([{ name: 'Recovered candidate', email: null }]);
  render(<ParticipantContext meetingId="A" disabled={false} onSelect={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('context unavailable');
  expect(screen.getByRole('button', { name: 'Save local candidates' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading candidates' }));
  expect(await screen.findByDisplayValue('Recovered candidate')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
