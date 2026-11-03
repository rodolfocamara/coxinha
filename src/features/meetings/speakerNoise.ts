import type { ProcessingReport, SpeakerLevel } from './library';

/**
 * Spec 0120 P5, from the owner's library on 2026-11-03: the smallest confirmed
 * participant spoke 16.4 s (5.1 % of its track); room bleed on the microphone
 * sat 25–28 dB under the owner, a real nearby voice 2.9 dB.
 */
export const BRIEF_SPEECH_MS = 15_000;
export const BRIEF_SHARE = 0.01;
export const BLEED_DB = 15;

export type Fold = 'brief' | 'bleed';

export const speakerKey = (track: string, speaker: string) => JSON.stringify([track, speaker]);
const anonymous = (speaker: string) => speaker.toLowerCase().includes('unknown');

/** Why each speaker leaves the naming list. Confirmed speakers never fold. */
export function foldedSpeakers(
  report: ProcessingReport,
  levels: SpeakerLevel[] | null
): Map<string, Fold> {
  const speech = new Map<string, number>();
  const perTrack = new Map<string, number>();
  for (const turn of report.turns) {
    const duration = turn.end_ms - turn.start_ms;
    perTrack.set(turn.track, (perTrack.get(turn.track) ?? 0) + duration);
    if (anonymous(turn.speaker)) continue;
    const key = speakerKey(turn.track, turn.speaker);
    speech.set(key, (speech.get(key) ?? 0) + duration);
  }
  const confirmed = new Set(
    report.assignments
      .filter((a) => a.state === 'confirmed' && a.track)
      .map((a) => speakerKey(a.track!, a.speaker))
  );
  let dominant: string | null = null;
  let most = -1;
  for (const turn of report.turns) {
    const key = speakerKey(turn.track, turn.speaker);
    if (turn.track === 'mic' && !anonymous(turn.speaker) && speech.get(key)! > most) {
      most = speech.get(key)!;
      dominant = turn.speaker;
    }
  }
  const level = (speaker: string | null) =>
    levels?.find((l) => l.track === 'mic' && l.speaker === speaker)?.levelDb;
  const folds = new Map<string, Fold>();
  for (const [key, duration] of speech) {
    if (confirmed.has(key)) continue;
    const [track, speaker] = JSON.parse(key) as [string, string];
    if (duration < BRIEF_SPEECH_MS || duration < BRIEF_SHARE * (perTrack.get(track) ?? 0)) {
      folds.set(key, 'brief');
      continue;
    }
    const owner = level(dominant);
    const own = level(speaker);
    if (track === 'mic' && speaker !== dominant && owner != null && own != null)
      if (owner - own >= BLEED_DB) folds.set(key, 'bleed');
  }
  return folds;
}
