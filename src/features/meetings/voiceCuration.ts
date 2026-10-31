import { invoke } from '@tauri-apps/api/core';

// Frozen DTO v1: docs/specs/0078-voice-curation-core.md
// SHA-256 8e14ff11602cde4ef67c91d87f1e4df334f086eec8ad8f3ded41bf78c35383e9
export type EmbeddingSpace = {
  model: string;
  revision: string;
  model_hash: string;
  preprocessing: string;
  dimension: number;
};
export type EnrollmentCandidates = {
  job: string;
  meetingId: string;
  track: string;
  speaker: string;
  profileGeneration: number;
  assignmentId: string | null;
  personId: string | null;
  assignmentRevision: number | null;
  turns: {
    turnId: string;
    startMs: number;
    endMs: number;
    eligible: boolean;
    reasons: (
      | 'unknown_speaker'
      | 'missing_embedding'
      | 'invalid_candidate'
      | 'provenance_mismatch'
      | 'same_track_overlap'
      | 'already_enrolled'
    )[];
    activeSampleCount: number;
  }[];
  quality: { noise: 'unmeasured'; echo: 'unmeasured'; otherTrack: 'unmeasured' };
};
export type SelectedEnrollment = {
  job: string;
  track: string;
  speaker: string;
  assignmentId: string;
  personId: string;
  turnIds: string[];
  humanOrigin: string;
  expectedAssignmentRevision: number;
};
export type VoiceProfiles = {
  profileGeneration: number;
  profiles: {
    personId: string;
    name: string;
    spaces: {
      spaceId: string;
      space: EmbeddingSpace;
      activeCount: number;
      activeDurationMs: number;
    }[];
    revokedCount: number;
    invalidatedCount: number;
  }[];
};
export type PersonSamples = {
  profileGeneration: number;
  personId: string;
  samples: {
    sampleId: string;
    assignmentId: string;
    assignmentRevision: number;
    currentAssignmentRevision: number;
    state: 'active' | 'revoked' | 'invalidated';
    spaceId: string;
    space: EmbeddingSpace;
    meetingId: string;
    track: string;
    startMs: number;
    endMs: number;
    createdAt: string;
    revokedAt: string | null;
  }[];
};
// Additive v2 pages; v1 success DTOs and compatibility adapters remain unchanged.
// Contract SHA-256 cd5d968b871f440da8c8492248b7b558e37126a8f8a9e99752e14d9a599db9ee
export type ProfilesPage = {
  profileGeneration: number;
  /** Totals per person: active (confirmed, unrevoked) samples and the meetings they come from. */
  profiles: { personId: string; name: string; activeSamples?: number; sampleMeetings?: number }[];
  nextCursor: string | null;
  scannedRows: number;
};
export type SamplesPage = {
  profileGeneration: number;
  personId: string;
  samples: PersonSamples['samples'];
  nextCursor: string | null;
  scannedRows: number;
};
export const voiceCuration = {
  candidates: (job: string, track: string, speaker: string) =>
    invoke<EnrollmentCandidates>('library_enrollment_candidates', { job, track, speaker }),
  enroll: (selection: SelectedEnrollment) =>
    invoke<{ sampleIds: string[]; profileGeneration: number }>('library_enroll_selected_turns', {
      ...selection,
    }),
  profiles: () => invoke<VoiceProfiles>('library_voice_profiles'),
  profilesPage: (cursor: string | null = null, limit = 25) =>
    invoke<ProfilesPage>('library_voice_profiles_page', { cursor, limit }),
  samplesPage: (personId: string, cursor: string | null = null, limit = 50) =>
    invoke<SamplesPage>('library_person_samples_page', { personId, cursor, limit }),
  samples: (personId: string) => invoke<PersonSamples>('library_person_samples', { personId }),
  revoke: (personId: string, sampleId: string, humanOrigin: string) =>
    invoke<null>('library_revoke_voice_sample', { personId, sampleId, humanOrigin }),
};
export type VoiceComparison = {
  job: string;
  experimental: true;
  profileGeneration: number;
  speakers: {
    track: string;
    speaker: string;
    queryStatus: 'eligible' | 'no_eligible_turns';
    spaces: {
      space: EmbeddingSpace;
      status: 'candidates' | 'no_compatible_history' | 'self_excluded' | 'no_candidates';
      invalidHistorySamples: number;
      candidates: {
        personId: string;
        name: string;
        meanCosine: number;
        maxCosine: number;
        supportTurns: number;
        supportDurationMs: number;
        activeSamples: number;
        turnDetailsTruncated: boolean;
        turns: { turnId: string; startMs: number; endMs: number; cosine: number }[];
      }[];
    }[];
  }[];
};
export const voiceComparison = (job: string) =>
  invoke<VoiceComparison>('library_voice_comparison', { job });
export function validVoiceOrigin(origin: string) {
  return (
    !!origin.trim() &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(origin) &&
    new TextEncoder().encode(origin.trim()).length <= 1000
  );
}
