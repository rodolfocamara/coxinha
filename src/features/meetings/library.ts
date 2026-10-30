import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';

export type LibraryMeeting = {
  id: string;
  title: string;
  createdAt: string;
  captureState: 'new' | 'recording' | 'finished' | 'interrupted';
};
export type Source = { name: string; description: string; monitor: boolean; is_default?: boolean };
export type Meter = { peak: number; lastBlockMs: number | null; error: string | null };
export type RecordingStorage = {
  directory: string;
  totalBytes: number | null;
  durationMs: number | null;
  files: { name: string; bytes: number | null }[];
};
export type CaptureStatus = {
  active: null | {
    meetingId: string;
    paused: boolean;
    elapsedMs: number;
    storage?: RecordingStorage | null;
    mic: Meter;
    output: Meter;
  };
  error: string | null;
  processing?: { meetingId: string; job: string | null; phase: string } | null;
};
export type LibraryDetail = {
  storage?: RecordingStorage | null;
  meeting: LibraryMeeting;
  manifest: null | {
    version: number;
    meeting: string;
    state: string;
    sample_rate: number;
    channels: number;
    clock: string;
    alignment: string;
    tracks: {
      source: string;
      file: string;
      frames: number;
      first_arrival_ns: number | null;
      last_arrival_ns: number | null;
      sha256: string | null;
    }[];
  };
  audio: Record<string, string> | null;
  inference: 'unavailable' | 'local';
};
export type ProcessingConfig = {
  engine_version: string;
  models: Record<string, { path: string; sha256: string; provenance: string }>;
  parameters: Record<string, unknown>;
};
export type ProcessingReport = {
  job: string;
  segments: {
    id: string;
    track: string;
    start_ms: number;
    end_ms: number;
    text: string;
    speaker: string | null;
  }[];
  turns: { id: string; track: string; start_ms: number; end_ms: number; speaker: string }[];
  warnings: string[];
  corrections: Record<string, string>;
  assignments: {
    id: string;
    speaker: string;
    track?: string | null;
    person_id: string | null;
    state: string;
    name: string | null;
  }[];
};
export type ProcessingDetail = {
  jobs: { id: string; state: string; attempts: number; error: string | null }[];
  report: ProcessingReport | null;
  people: { id: string; name: string }[];
};
export type ParticipantCandidate = { name: string; email: string | null };
export type Recognition = {
  job: string;
  calibrationStatus: 'uncalibrated' | 'calibrated';
  profileGeneration: number;
  speakers: {
    speaker: string;
    track: string;
    state: 'unknown' | 'suggested';
    reason: string;
    personId: string | null;
    name: string | null;
    policyId: string | null;
    cosineSimilarity: number | null;
  }[];
};
const grantedAudio = new Map<string, 'loopback' | 'asset'>();
let audioAuthority: string | undefined;

function acceptAudio(detail: LibraryDetail): LibraryDetail {
  let authority = audioAuthority;
  const grants = Object.values(detail.audio ?? {}).map((value) => {
    const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/audio\/[a-f0-9]{64}\.wav$/.exec(value);
    if (match && Number(match[1]) <= 65535) {
      const next = `127.0.0.1:${match[1]}`;
      if (authority && authority !== next) throw new Error('Unexpected audio transport');
      authority = next;
      return [value, 'loopback'] as const;
    }
    // Other platforms still grant individual absolute files through Tauri's asset scope.
    if (!value.includes('://') && /^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+|\/(?!\/))/.test(value)) {
      return [value, 'asset'] as const;
    }
    throw new Error('Invalid audio transport');
  });
  audioAuthority = authority;
  for (const [value, transport] of grants) {
    grantedAudio.set(value, transport);
    if (grantedAudio.size > 256) grantedAudio.delete(grantedAudio.keys().next().value!);
  }
  return detail;
}

export const library = {
  available: isTauri,
  importAudio: (title: string, path: string) =>
    invoke<LibraryDetail>('library_import_audio', { title, path }).then(acceptAudio),
  recognition: (job: string) => invoke<Recognition>('library_recognition', { job }),
  participantContext: (meetingId: string) =>
    invoke<ParticipantCandidate[]>('library_participant_context', { meetingId }),
  setParticipantContext: (meetingId: string, participants: ParticipantCandidate[]) =>
    invoke<ParticipantCandidate[]>('library_set_participant_context', { meetingId, participants }),
  list: () => invoke<LibraryMeeting[]>('library_list'),
  sources: () => invoke<Source[]>('library_sources'),
  status: () => invoke<CaptureStatus>('library_status'),
  start: (title: string, micSource: string, outputSource: string) =>
    invoke<CaptureStatus>('library_start', { title, micSource, outputSource }),
  pause: (paused: boolean) => invoke<CaptureStatus>('library_pause', { paused }),
  stop: () => invoke<CaptureStatus>('library_stop'),
  detail: (meetingId: string) =>
    invoke<LibraryDetail>('library_detail', { meetingId }).then(acceptAudio),
  recover: (meetingId: string) =>
    invoke<LibraryDetail>('library_recover', { meetingId }).then(acceptAudio),
  processing: (meetingId: string, jobId?: string) =>
    invoke<ProcessingDetail>('library_processing', { meetingId, jobId }),
  process: (meetingId: string, config: ProcessingConfig) =>
    invoke<CaptureStatus>('library_process', { meetingId, config }),
  createPerson: (name: string, consentOrigin: string) =>
    invoke<string>('library_create_person', { name, consentOrigin }),
  confirmSpeaker: (
    job: string,
    speaker: string,
    personId: string,
    humanOrigin: string,
    enroll = false,
    track?: string
  ) =>
    invoke<void>('library_confirm_speaker', { job, speaker, personId, humanOrigin, enroll, track }),
  revokeAssignment: (assignmentId: string, humanOrigin: string) =>
    invoke<void>('library_revoke_assignment', { assignmentId, humanOrigin }),
  editSegment: (meetingId: string, target: string, body: string) =>
    invoke<void>('library_edit_segment', { meetingId, target, body }),
  audioUrl: (value: string) => {
    const transport = grantedAudio.get(value);
    if (!transport) throw new Error('Audio source was not granted');
    return transport === 'loopback' ? value : convertFileSrc(value);
  },
};
export function validSources(sources: Source[], mic: string, output: string) {
  return (
    mic !== output &&
    sources.some((s) => s.name === mic && !s.monitor) &&
    sources.some((s) => s.name === output && s.monitor)
  );
}
export function meterDiagnostic(meter: Meter, paused: boolean) {
  if (meter.error) return 'error';
  if (paused) return 'paused';
  if (meter.lastBlockMs === null) return 'waiting';
  if (meter.lastBlockMs > 2000) return 'stalled';
  return meter.peak < 0.001 ? 'silence' : 'receiving';
}
