import type { CalendarEvent } from '../agenda/calendar';

const MARGIN_MS = 30 * 60_000;
const MAX_CANDIDATES = 4;

/**
 * Events a recording may belong to (spec 0111): the proposal first, then
 * the events around the recording by overlap, nearest start breaking ties.
 */
export function matchCandidates(
  events: CalendarEvent[],
  start: Date,
  durationMs: number | null,
  proposal: CalendarEvent | null
): CalendarEvent[] {
  const from = start.getTime();
  const to = from + (durationMs ?? MARGIN_MS);
  const overlap = (e: CalendarEvent) =>
    Math.min(to, Date.parse(e.endsAt)) - Math.max(from, Date.parse(e.startsAt));
  const near = events.filter(
    (e) =>
      !e.cancelled &&
      !e.allDay &&
      e.id !== proposal?.id &&
      Date.parse(e.startsAt) < to + MARGIN_MS &&
      Date.parse(e.endsAt) > from - MARGIN_MS
  );
  near.sort(
    (a, b) =>
      overlap(b) - overlap(a) ||
      Math.abs(Date.parse(a.startsAt) - from) - Math.abs(Date.parse(b.startsAt) - from)
  );
  return [...(proposal ? [proposal] : []), ...near].slice(0, MAX_CANDIDATES);
}
