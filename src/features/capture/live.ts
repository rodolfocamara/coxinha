import { create } from 'zustand';
import { invoke, isTauri } from '@tauri-apps/api/core';

/** Spec 0097 P3: live transcript with the Tagarela model, off by default. */
export type LiveSettings = { enabled: boolean; modelPath: string; nThreads: number };
export type LiveSegment = {
  track: 'Mic' | 'Output';
  startFrame: number;
  endFrame: number;
  startMs: number;
  endMs: number;
  text: string;
};
export type LiveTranscript = {
  segments: LiveSegment[];
  state: 'idle' | 'queued' | 'loading' | 'running' | 'draining' | 'paused' | 'failed';
  error: string | null;
  behindMs: number;
  paused: boolean;
  /** Both tracks transcribed up to the end of the recording (silence included). */
  complete: boolean;
};
export type LiveSnapshot = {
  meeting: string | null;
  state: string;
  error: string | null;
  behindMs: number;
  queued: string[];
};
/** Spec 0097 P4 / ADR 0024: suggested title from the user's own host over SSH. */
export type TitleLlmSettings = {
  enabled: boolean;
  sshTarget: string;
  remotePort: number;
  model: string;
};
export type TitleSuggestion = {
  title: string;
  placeholder: string;
  sessionId: string;
  source: string;
  model: string;
  endpointHost: string;
  at: string;
  inputTokens: number;
  stage: 'first' | 'final';
  applied: boolean;
  dismissed: boolean;
};

/** Handy keeps its models here on Linux; suggested, opened read-only. */
export const HANDY_TAGARELA =
  '.local/share/com.pais.handy/models/parakeet-v3-ptbr-tagarela-matched-q8.gguf';

export const live = {
  settings: () => invoke<LiveSettings>('live_settings'),
  saveSettings: (settings: LiveSettings) => invoke<LiveSettings>('set_live_settings', { settings }),
  transcript: (meetingId: string) =>
    invoke<LiveTranscript>('library_live_transcript', { meetingId }),
  status: () => invoke<LiveSnapshot>('library_live_status'),
  pause: (paused: boolean) => invoke<null>('library_live_pause', { paused }),
  resume: (meetingId: string) => invoke<null>('library_live_resume', { meetingId }),
  titleSettings: () => invoke<TitleLlmSettings>('title_llm_settings'),
  saveTitleSettings: (settings: TitleLlmSettings) =>
    invoke<TitleLlmSettings>('set_title_llm_settings', { settings }),
  testTitle: (settings: TitleLlmSettings) => invoke<string>('title_llm_test', { settings }),
  suggestion: (meetingId: string) =>
    invoke<TitleSuggestion | null>('library_title_suggestion', { meetingId }),
  dismissSuggestion: (meetingId: string) =>
    invoke<TitleSuggestion | null>('library_dismiss_title_suggestion', { meetingId }),
};

/** Strip state, refreshed by the capture controller (snapshot only, no files). */
export const useLiveStatus = create<{ snapshot: LiveSnapshot | null }>(() => ({ snapshot: null }));

export async function refreshLiveStatus() {
  if (!isTauri()) return;
  try {
    useLiveStatus.setState({ snapshot: await live.status() });
  } catch {
    /* Older backend: live transcription simply stays hidden. */
  }
}
