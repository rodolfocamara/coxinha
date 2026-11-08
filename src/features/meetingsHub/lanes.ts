import type { ProcessingReport } from '../meetings/library';

export type LaneSegment = { startMs: number; endMs: number; left: number; width: number };
export type Lane = {
  key: string;
  track: string;
  speaker: string;
  /** Confirmed person name; null while the speaker waits for confirmation. */
  name: string | null;
  ms: number;
  share: number;
  /** Person hue 1..4, by lane order so neighbours never share a colour. */
  hue: number;
  /** 1-based position, used to name a speaker still to confirm. */
  index: number;
  segments: LaneSegment[];
};

/**
 * Speaker lanes ("faixa de falas", spec 0096): one lane per diarized speaker
 * per track, with its share of spoken time and its turns placed on the
 * meeting's timeline. Anonymous `unknown` speech is not a lane.
 */
export function buildLanes(
  report: ProcessingReport | null | undefined,
  durationMs?: number | null
) {
  if (!report) return { lanes: [] as Lane[], totalMs: 0, unconfirmed: 0 };
  const spans = report.turns.length
    ? report.turns
    : report.segments.flatMap((s) => (s.speaker ? [{ ...s, speaker: s.speaker }] : []));
  const usable = spans.filter((s) => s.speaker !== 'unknown' && s.end_ms > s.start_ms);
  const totalMs = Math.max(durationMs ?? 0, ...usable.map((s) => s.end_ms), 0);
  if (!totalMs) return { lanes: [], totalMs: 0, unconfirmed: 0 };
  const byKey = new Map<string, Lane>();
  for (const span of [...usable].sort((a, b) => a.start_ms - b.start_ms)) {
    const key = `${span.track}:${span.speaker}`;
    let lane = byKey.get(key);
    if (!lane) {
      const confirmed = report.assignments.find(
        (a) =>
          a.speaker === span.speaker &&
          (a.track == null || a.track === span.track) &&
          a.state === 'confirmed'
      );
      lane = {
        key,
        track: span.track,
        speaker: span.speaker,
        name: confirmed?.name ?? null,
        ms: 0,
        share: 0,
        hue: (byKey.size % 4) + 1,
        index: byKey.size + 1,
        segments: [],
      };
      byKey.set(key, lane);
    }
    lane.ms += span.end_ms - span.start_ms;
    lane.segments.push({
      startMs: span.start_ms,
      endMs: span.end_ms,
      left: (span.start_ms / totalMs) * 100,
      width: Math.max(0.6, ((span.end_ms - span.start_ms) / totalMs) * 100),
    });
  }
  const lanes = [...byKey.values()];
  const spoken = lanes.reduce((sum, lane) => sum + lane.ms, 0) || 1;
  for (const lane of lanes) lane.share = Math.round((lane.ms / spoken) * 100);
  return { lanes, totalMs, unconfirmed: lanes.filter((l) => !l.name).length };
}
