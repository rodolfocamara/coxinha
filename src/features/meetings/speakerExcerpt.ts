import type { ProcessingReport } from './library';
import type { Excerpt } from './useBoundedPlayback';
export function speakerExcerpt(
  report: ProcessingReport,
  track: string,
  speaker: string
): Excerpt | null {
  // No thresholds or confidence estimates: choose an existing isolated turn.
  const turns = report.turns.filter(
    (t) =>
      t.track === track &&
      t.speaker === speaker &&
      Number.isFinite(t.start_ms) &&
      Number.isFinite(t.end_ms) &&
      t.start_ms >= 0 &&
      t.end_ms > t.start_ms &&
      !report.turns.some(
        (other) =>
          other.track === track &&
          other.speaker !== speaker &&
          other.start_ms < t.end_ms &&
          other.end_ms > t.start_ms
      )
  );
  turns.sort((a, b) => b.end_ms - b.start_ms - (a.end_ms - a.start_ms) || a.start_ms - b.start_ms);
  const turn = turns[0];
  return turn
    ? {
        track,
        start: turn.start_ms / 1000,
        end: Math.min(turn.end_ms / 1000, turn.start_ms / 1000 + 12),
      }
    : null;
}
