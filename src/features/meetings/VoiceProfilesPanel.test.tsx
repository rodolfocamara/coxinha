import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { VoiceProfilesPanel } from './VoiceProfilesPanel';
import { VoiceComparisonPanel } from './VoiceComparisonPanel';
import {
  voiceComparison,
  voiceCuration,
  type ProfilesPage,
  type SamplesPage,
} from './voiceCuration';
vi.mock('./voiceCuration', async (original) => ({
  ...(await original<typeof import('./voiceCuration')>()),
  voiceCuration: {
    profiles: vi.fn(),
    samples: vi.fn(),
    profilesPage: vi.fn(),
    samplesPage: vi.fn(),
    revoke: vi.fn(),
  },
  voiceComparison: vi.fn(),
}));
const space = {
  model: 'model',
  revision: 'r1',
  model_hash: 'hash-one',
  preprocessing: 'p1',
  dimension: 2,
};
const profiles: ProfilesPage = {
  profileGeneration: 3,
  profiles: [
    { personId: 'ana', name: 'Ana' },
    { personId: 'bruno', name: 'Bruno' },
  ],
  nextCursor: null,
  scannedRows: 2,
};
const samples: SamplesPage = {
  profileGeneration: 3,
  personId: 'ana',
  nextCursor: null,
  scannedRows: 4,
  samples: ['active', 'revoked', 'invalidated', 'active'].map((state, index) => ({
    sampleId: `sample-${index}`,
    assignmentId: 'assignment',
    assignmentRevision: 1,
    currentAssignmentRevision: state === 'invalidated' ? 2 : 1,
    state: state as 'active' | 'revoked' | 'invalidated',
    spaceId: index === 3 ? 'two' : 'one',
    space: index === 3 ? { ...space, model_hash: 'hash-two', preprocessing: 'p2' } : space,
    meetingId: 'source-meeting',
    track: 'mic',
    startMs: 1000,
    endMs: index === 3 ? 3000 : 2000,
    createdAt: '2026-10-25 12:00:00',
    revokedAt: null,
  })),
};
const props = {
  version: 'v1',
  disabled: false,
  act: async (action: () => Promise<unknown>) => {
    await action();
  },
};
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('en');
  vi.mocked(voiceCuration.profilesPage).mockResolvedValue(profiles);
  vi.mocked(voiceCuration.samplesPage).mockResolvedValue(samples);
  vi.mocked(voiceCuration.revoke).mockResolvedValue(null);
});
async function openProfiles() {
  fireEvent.click(screen.getByText(i18n.t('voiceCuration.profiles'), { selector: 'summary' }));
  await screen.findByText('Ana · ana', { selector: 'summary' });
}
async function openSamples() {
  fireEvent.click(screen.getByText('Ana · ana', { selector: 'summary' }));
  await screen.findByText('sample-0 · ' + i18n.t('voiceCuration.sampleStates.active'));
}
for (const locale of ['en', 'pt-BR'])
  it(`uses loaded samples for compatible-space counts and truthful history in ${locale}`, async () => {
    await i18n.changeLanguage(locale);
    render(<VoiceProfilesPanel {...props} />);
    expect(voiceCuration.profilesPage).not.toHaveBeenCalled();
    await openProfiles();
    expect(voiceCuration.samplesPage).not.toHaveBeenCalled();
    await openSamples();
    expect(
      screen.getByText(
        i18n.t('voiceCuration.loadedCountsComplete', { active: 2, revoked: 1, invalidated: 1 })
      )
    ).toBeVisible();
    expect(
      screen.getByText(i18n.t('voiceCuration.loadedSpaceComplete', { count: 1, duration: '0:02' }))
    ).toBeVisible();
    expect(
      screen.getByText('sample-1 · ' + i18n.t('voiceCuration.sampleStates.revoked'))
    ).toBeVisible();
    expect(screen.getByText(new RegExp(i18n.t('voiceCuration.unknownDate')))).toBeVisible();
    expect(voiceCuration.profiles).not.toHaveBeenCalled();
    expect(voiceCuration.samples).not.toHaveBeenCalled();
  });
it('loads people only on explicit actions, preserves server order and never appends a duplicate person', async () => {
  vi.mocked(voiceCuration.profilesPage).mockResolvedValueOnce({
    ...profiles,
    profiles: [profiles.profiles[1]],
    nextCursor: 'p1',
    scannedRows: 1,
  });
  let finish!: (page: ProfilesPage) => void;
  vi.mocked(voiceCuration.profilesPage).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render(<VoiceProfilesPanel {...props} />);
  fireEvent.click(screen.getByText('Private voice memory', { selector: 'summary' }));
  await screen.findByText('Bruno · bruno', { selector: 'summary' });
  expect(voiceCuration.profilesPage).toHaveBeenCalledTimes(1);
  expect(screen.getByText(i18n.t('voiceCuration.peopleLoadedPartial', { count: 1 }))).toBeVisible();
  const more = screen.getByRole('button', { name: 'Load more people' });
  fireEvent.click(more);
  fireEvent.click(more);
  expect(voiceCuration.profilesPage).toHaveBeenCalledTimes(2);
  await act(async () =>
    finish({ ...profiles, profiles: [profiles.profiles[0], profiles.profiles[1]] })
  );
  expect(
    screen.getAllByText(/^(Bruno · bruno|Ana · ana)$/).map((node) => node.textContent)
  ).toEqual(['Bruno · bruno', 'Ana · ana']);
  expect(
    screen.getByText(i18n.t('voiceCuration.peopleLoadedComplete', { count: 2 }))
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Load more people' })).toBeNull();
  expect(voiceCuration.profilesPage).toHaveBeenLastCalledWith('p1');
  expect(voiceCuration.samplesPage).not.toHaveBeenCalled();
});
it('keeps empty progress pages partial and requires explicit load more for both people and samples', async () => {
  vi.mocked(voiceCuration.profilesPage)
    .mockResolvedValueOnce({
      ...profiles,
      profiles: [],
      nextCursor: 'empty-people',
      scannedRows: 4096,
    })
    .mockResolvedValue({ ...profiles, profiles: [profiles.profiles[0]] });
  vi.mocked(voiceCuration.samplesPage)
    .mockResolvedValueOnce({
      ...samples,
      samples: [],
      nextCursor: 'empty-samples',
      scannedRows: 4096,
    })
    .mockResolvedValue({ ...samples, samples: [samples.samples[0]] });
  render(<VoiceProfilesPanel {...props} />);
  fireEvent.click(screen.getByText('Private voice memory', { selector: 'summary' }));
  expect(
    await screen.findByText(i18n.t('voiceCuration.peopleLoadedPartial', { count: 0 }))
  ).toBeVisible();
  expect(screen.queryByText(i18n.t('voiceCuration.noProfiles'))).toBeNull();
  expect(voiceCuration.profilesPage).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Load more people' }));
  await screen.findByText('Ana · ana', { selector: 'summary' });
  fireEvent.click(screen.getByText('Ana · ana', { selector: 'summary' }));
  expect(
    await screen.findByText(i18n.t('voiceCuration.samplesLoadedPartial', { count: 0 }))
  ).toBeVisible();
  expect(screen.queryByText(i18n.t('voiceCuration.noSamples'))).toBeNull();
  expect(voiceCuration.samplesPage).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Load more samples' }));
  await screen.findByText('sample-0 · Active');
  expect(
    screen.getByText(i18n.t('voiceCuration.samplesLoadedComplete', { count: 1 }))
  ).toBeVisible();
  expect(voiceCuration.samplesPage).toHaveBeenLastCalledWith('ana', 'empty-samples');
});
it('keeps interleaved people sample pages and cursors independent and counts only loaded intervals', async () => {
  vi.mocked(voiceCuration.samplesPage).mockImplementation(async (person, cursor) =>
    person === 'ana'
      ? {
          ...samples,
          samples: cursor ? [samples.samples[1]] : [samples.samples[0]],
          nextCursor: cursor ? null : 'ana-cursor',
          scannedRows: cursor ? 4096 : 1,
        }
      : {
          ...samples,
          personId: 'bruno',
          samples: [{ ...samples.samples[3], sampleId: 'bruno-sample' }],
          nextCursor: null,
          scannedRows: 4096,
        }
  );
  render(<VoiceProfilesPanel {...props} />);
  await openProfiles();
  await openSamples();
  expect(
    screen.getByText(
      i18n.t('voiceCuration.loadedCountsPartial', { active: 1, revoked: 0, invalidated: 0 })
    )
  ).toBeVisible();
  fireEvent.click(screen.getByText('Bruno · bruno', { selector: 'summary' }));
  await screen.findByText('bruno-sample · Active');
  const ana = screen.getByText('Ana · ana', { selector: 'summary' }).closest('details')!;
  expect(within(ana).queryByText('bruno-sample · Active')).toBeNull();
  fireEvent.click(within(ana).getByRole('button', { name: 'Load more samples' }));
  await screen.findByText('sample-1 · Revoked');
  expect(voiceCuration.samplesPage).toHaveBeenCalledWith('ana', 'ana-cursor');
  expect(voiceCuration.samplesPage).toHaveBeenCalledWith('bruno', null);
});
it('preserves a stale view on generation mismatch and disables mutations until explicit root restart', async () => {
  vi.mocked(voiceCuration.profilesPage)
    .mockResolvedValueOnce({ ...profiles, profiles: [profiles.profiles[0]], nextCursor: 'old' })
    .mockResolvedValueOnce({ ...profiles, profileGeneration: 4, profiles: [profiles.profiles[1]] })
    .mockResolvedValue({ ...profiles, profileGeneration: 4 });
  render(<VoiceProfilesPanel {...props} />);
  await openProfiles();
  await openSamples();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Human review' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load more people' }));
  expect(await screen.findByText(i18n.t('voiceCuration.staleView'))).toBeVisible();
  expect(screen.queryByText('Bruno · bruno', { selector: 'summary' })).toBeNull();
  expect(screen.getByText('sample-0 · Active')).toBeVisible();
  const revoke = screen.getAllByRole('button', { name: 'Revoke this sample' })[0];
  expect(revoke).toBeDisabled();
  fireEvent.click(revoke);
  expect(voiceCuration.revoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Restart people list' }));
  await screen.findByText('Bruno · bruno', { selector: 'summary' });
  expect(voiceCuration.profilesPage).toHaveBeenLastCalledWith(null);
});
it('invalidates after a successful revoke without auto-refresh, then explicitly restarts with truthful retained history', async () => {
  render(<VoiceProfilesPanel {...props} />);
  await openProfiles();
  await openSamples();
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Explicit sample correction' },
  });
  fireEvent.click(screen.getAllByRole('button', { name: 'Revoke this sample' })[0]);
  await waitFor(() =>
    expect(voiceCuration.revoke).toHaveBeenCalledWith(
      'ana',
      'sample-0',
      'Explicit sample correction'
    )
  );
  const stale = await screen.findAllByText(i18n.t('voiceCuration.staleView'));
  expect(stale[0]).toBeVisible();
  expect(voiceCuration.samplesPage).toHaveBeenCalledTimes(1);
  expect(screen.getByText('sample-0 · Active')).toBeVisible();
  vi.mocked(voiceCuration.samplesPage).mockResolvedValue({
    ...samples,
    profileGeneration: 4,
    samples: samples.samples.map((sample) =>
      sample.sampleId === 'sample-0'
        ? { ...sample, state: 'revoked' as const, revokedAt: '2026-10-25 13:00:00' }
        : sample
    ),
  });
  vi.mocked(voiceCuration.profilesPage).mockResolvedValue({ ...profiles, profileGeneration: 4 });
  fireEvent.click(screen.getByRole('button', { name: 'Restart people list' }));
  await screen.findByText('Ana · ana', { selector: 'summary' });
  fireEvent.click(screen.getByText('Ana · ana', { selector: 'summary' }));
  await screen.findByText('sample-0 · Revoked');
  expect(screen.getByText(/Latest audited revocation: 2026-10-25 13:00:00 UTC/)).toBeVisible();
  expect(voiceCuration.samplesPage).toHaveBeenLastCalledWith('ana', null);
});
it('ignores late append replies after a mutation version change and preserves rows as stale until restart', async () => {
  vi.mocked(voiceCuration.samplesPage).mockResolvedValueOnce({
    ...samples,
    samples: [samples.samples[0]],
    nextCursor: 'next',
  });
  let finish!: (page: SamplesPage) => void;
  vi.mocked(voiceCuration.samplesPage).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const view = render(<VoiceProfilesPanel {...props} />);
  await openProfiles();
  await openSamples();
  fireEvent.click(screen.getByRole('button', { name: 'Load more samples' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  view.rerender(<VoiceProfilesPanel {...props} version="after-mutation" />);
  expect(screen.getAllByText(i18n.t('voiceCuration.staleView')).length).toBeGreaterThan(0);
  await act(async () => finish({ ...samples, samples: [samples.samples[1]] }));
  expect(screen.queryByText('sample-1 · Revoked')).toBeNull();
  expect(screen.getByText('sample-0 · Active')).toBeVisible();
  expect(voiceCuration.profilesPage).toHaveBeenCalledTimes(1);
});
it.each(['voice_curation_refresh_required', 'voice_curation_cursor_invalid'])(
  'localizes %s while retaining loaded people for explicit restart',
  async (code) => {
    vi.mocked(voiceCuration.profilesPage)
      .mockResolvedValueOnce({ ...profiles, profiles: [profiles.profiles[0]], nextCursor: 'next' })
      .mockRejectedValueOnce(`${code}\nsafe category`);
    render(<VoiceProfilesPanel {...props} />);
    await openProfiles();
    fireEvent.click(screen.getByRole('button', { name: 'Load more people' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t(`voiceCuration.errors.${code}`)
    );
    expect(screen.getByText('Ana · ana', { selector: 'summary' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Load more people' })).toBeDisabled();
  }
);
it('keeps metadata/other people usable when one person page is invalid and allows fresh-row revoke despite comparison capacity', async () => {
  vi.mocked(voiceCuration.samplesPage).mockImplementation(async (person) => {
    if (person === 'ana') throw 'voice_curation_inventory_row_invalid';
    return { ...samples, personId: 'bruno', samples: [samples.samples[0]] };
  });
  vi.mocked(voiceComparison).mockRejectedValue('voice_curation_capacity_exceeded');
  render(
    <>
      <VoiceProfilesPanel {...props} />
      <VoiceComparisonPanel job="job" version="v1" disabled={false} />
    </>
  );
  await openProfiles();
  fireEvent.click(screen.getByText('Ana · ana', { selector: 'summary' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    i18n.t('voiceCuration.errors.voice_curation_inventory_row_invalid')
  );
  fireEvent.click(
    screen.getByText('Experimental cross-meeting comparison', { selector: 'summary' })
  );
  await screen.findByText(i18n.t('voiceCuration.errors.voice_curation_capacity_exceeded'));
  fireEvent.click(screen.getByText('Bruno · bruno', { selector: 'summary' }));
  await screen.findByText('sample-0 · Active');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Explicit correction' } });
  fireEvent.click(screen.getByRole('button', { name: 'Revoke this sample' }));
  await waitFor(() =>
    expect(voiceCuration.revoke).toHaveBeenCalledWith('bruno', 'sample-0', 'Explicit correction')
  );
});

it('rejects a mismatched person page without exposing its rows or allowing a mutation', async () => {
  vi.mocked(voiceCuration.samplesPage).mockResolvedValue({
    ...samples,
    personId: 'foreign-person',
  });
  render(<VoiceProfilesPanel {...props} />);
  await openProfiles();
  fireEvent.click(screen.getByText('Ana · ana', { selector: 'summary' }));
  const person = screen.getByText('Ana · ana', { selector: 'summary' }).closest('details')!;
  expect(await within(person).findByRole('alert')).toHaveTextContent(
    i18n.t('voiceCuration.errors.voice_curation_refresh_required')
  );
  expect(screen.getByRole('button', { name: 'Restart people list' })).toBeVisible();
  expect(screen.queryByText('sample-0 · Active')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Revoke this sample' })).toBeNull();
});

it('rejects a newer first sample generation than the loaded metadata before exposing rows or allowing mutation', async () => {
  vi.mocked(voiceCuration.samplesPage).mockResolvedValue({ ...samples, profileGeneration: 4 });
  render(<VoiceProfilesPanel {...props} />);
  await openProfiles();
  fireEvent.click(screen.getByText('Ana · ana', { selector: 'summary' }));
  await screen.findByRole('button', { name: 'Restart people list' });
  expect(screen.queryByText('sample-0 · Active')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Revoke this sample' })).toBeNull();
});
