import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { validVoiceOrigin, voiceComparison, voiceCuration } from './voiceCuration';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
beforeEach(() => vi.mocked(invoke).mockReset());
it('uses the frozen private command names and camelCase selected revision arguments', async () => {
  const selection = {
    job: 'job',
    track: 'output',
    speaker: 'speaker-1',
    assignmentId: 'a',
    personId: 'p',
    expectedAssignmentRevision: 7,
    turnIds: ['turn'],
    humanOrigin: 'Reviewed with consent',
  };
  await voiceCuration.candidates('job', 'output', 'speaker-1');
  expect(invoke).toHaveBeenLastCalledWith('library_enrollment_candidates', {
    job: 'job',
    track: 'output',
    speaker: 'speaker-1',
  });
  await voiceCuration.enroll(selection);
  expect(invoke).toHaveBeenLastCalledWith('library_enroll_selected_turns', selection);
  await voiceCuration.profiles();
  expect(invoke).toHaveBeenLastCalledWith('library_voice_profiles');
  await voiceCuration.samples('p');
  expect(invoke).toHaveBeenLastCalledWith('library_person_samples', { personId: 'p' });
  await voiceCuration.revoke('p', 'sample', 'Human correction');
  expect(invoke).toHaveBeenLastCalledWith('library_revoke_voice_sample', {
    personId: 'p',
    sampleId: 'sample',
    humanOrigin: 'Human correction',
  });
  await voiceComparison('job');
  expect(invoke).toHaveBeenLastCalledWith('library_voice_comparison', { job: 'job' });
});
it('retains the snake_case model_hash from the exact space DTO', async () => {
  const value = {
    profileGeneration: 2,
    profiles: [
      {
        personId: 'p',
        name: 'Name',
        revokedCount: 0,
        invalidatedCount: 0,
        spaces: [
          {
            spaceId: 'space',
            activeCount: 1,
            activeDurationMs: 1000,
            space: {
              model: 'model',
              revision: 'r1',
              model_hash: 'hash',
              preprocessing: 'p1',
              dimension: 2,
            },
          },
        ],
      },
    ],
  };
  vi.mocked(invoke).mockResolvedValue(value);
  expect(await voiceCuration.profiles()).toEqual(value);
});
it('enforces the documented human origin byte/control bounds without inventing provenance', () => {
  expect(validVoiceOrigin('')).toBe(false);
  expect(validVoiceOrigin('  ')).toBe(false);
  expect(validVoiceOrigin('a\nb')).toBe(false);
  expect(validVoiceOrigin('á'.repeat(501))).toBe(false);
  expect(validVoiceOrigin('á'.repeat(500))).toBe(true);
});
it('uses only the additive v2 page commands with explicit bounded defaults and opaque cursors', async () => {
  await voiceCuration.profilesPage();
  expect(invoke).toHaveBeenLastCalledWith('library_voice_profiles_page', {
    cursor: null,
    limit: 25,
  });
  await voiceCuration.profilesPage('people-cursor', 50);
  expect(invoke).toHaveBeenLastCalledWith('library_voice_profiles_page', {
    cursor: 'people-cursor',
    limit: 50,
  });
  await voiceCuration.samplesPage('p');
  expect(invoke).toHaveBeenLastCalledWith('library_person_samples_page', {
    personId: 'p',
    cursor: null,
    limit: 50,
  });
  await voiceCuration.samplesPage('p', 'samples-cursor', 100);
  expect(invoke).toHaveBeenLastCalledWith('library_person_samples_page', {
    personId: 'p',
    cursor: 'samples-cursor',
    limit: 100,
  });
});
