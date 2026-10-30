import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { VoiceComparisonPanel } from './VoiceComparisonPanel';
import { voiceComparison, type VoiceComparison } from './voiceCuration';
vi.mock('./voiceCuration', () => ({ voiceComparison: vi.fn() }));
const space = {
  model: 'model',
  revision: 'r1',
  model_hash: 'hash',
  preprocessing: 'p1',
  dimension: 2,
};
const evidence: VoiceComparison = {
  job: 'job',
  experimental: true,
  profileGeneration: 1,
  speakers: [
    {
      track: 'mic',
      speaker: 'speaker-1',
      queryStatus: 'eligible',
      spaces: [
        {
          space,
          status: 'candidates',
          invalidHistorySamples: 2,
          candidates: [
            {
              personId: 'ana-uuid',
              name: 'Ana',
              meanCosine: 0.6,
              maxCosine: 0.9,
              supportTurns: 33,
              supportDurationMs: 33000,
              activeSamples: 2,
              turnDetailsTruncated: true,
              turns: [{ turnId: 'first', startMs: 1000, endMs: 2000, cosine: 0.6 }],
            },
          ],
        },
      ],
    },
  ],
};
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('en');
  vi.mocked(voiceComparison).mockResolvedValue(evidence);
});
async function open() {
  fireEvent.click(screen.getByText(i18n.t('voiceCuration.comparison'), { selector: 'summary' }));
  await waitFor(() => expect(voiceComparison).toHaveBeenCalled());
}
for (const locale of ['en', 'pt-BR'])
  it(`shows manual experimental evidence without selection/apply controls in ${locale}`, async () => {
    await i18n.changeLanguage(locale);
    render(<VoiceComparisonPanel job="job" version="v1" disabled={false} />);
    expect(voiceComparison).not.toHaveBeenCalled();
    await open();
    expect(await screen.findByText('Ana · ana-uuid')).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('voiceCuration.invalidHistory', { count: 2 }))
    ).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('voiceCuration.cosines', { mean: '0.600', max: '0.900' }))
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1); // Refresh is the only action.
    fireEvent.click(
      screen.getByText(i18n.t('voiceCuration.turnEvidence'), { selector: 'summary' })
    );
    expect(screen.getByText(i18n.t('voiceCuration.truncated'))).toBeVisible();
  });
it.each(['no_compatible_history', 'self_excluded', 'no_candidates'] as const)(
  'renders space status %s independently of query eligibility',
  async (status) => {
    vi.mocked(voiceComparison).mockResolvedValue({
      ...evidence,
      speakers: [
        {
          ...evidence.speakers[0],
          spaces: [{ ...evidence.speakers[0].spaces[0], status, candidates: [] }],
        },
      ],
    });
    render(<VoiceComparisonPanel job="job" version="v1" disabled={false} />);
    await open();
    expect(
      await screen.findByText(i18n.t(`voiceCuration.comparisonStates.${status}`))
    ).toBeInTheDocument();
    expect(screen.queryByText('Ana · ana-uuid')).toBeNull();
  }
);
it('distinguishes no eligible query, empty report and read failures, and ignores a stale old job', async () => {
  let finish!: (value: VoiceComparison) => void;
  vi.mocked(voiceComparison).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const view = render(<VoiceComparisonPanel job="old" version="v1" disabled={false} />);
  await open();
  vi.mocked(voiceComparison).mockResolvedValue({
    ...evidence,
    job: 'new',
    speakers: [
      { track: 'mic', speaker: 'speaker-1', queryStatus: 'no_eligible_turns', spaces: [] },
    ],
  });
  view.rerender(<VoiceComparisonPanel job="new" version="v2" disabled={false} />);
  expect(await screen.findByText(i18n.t('voiceCuration.noEligibleQuery'))).toBeInTheDocument();
  await act(async () => finish({ ...evidence, job: 'old' }));
  expect(screen.queryByText('Ana · ana-uuid')).toBeNull();
  vi.mocked(voiceComparison).mockRejectedValueOnce(new Error('comparison unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh voice evidence' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('comparison unavailable');
  vi.mocked(voiceComparison).mockResolvedValue({ ...evidence, job: 'new', speakers: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh voice evidence' }));
  expect(await screen.findByText(i18n.t('voiceCuration.noComparison'))).toBeInTheDocument();
});
