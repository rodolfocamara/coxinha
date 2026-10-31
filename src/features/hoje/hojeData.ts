import type { CalendarEvent } from '../agenda/calendar';
import type { Board, BoardItem } from '../board/model';
import type { Session } from '../sessions/sessions';
import { dayKey, localDay, nextDay, periodRange, sessionDate } from '../sessions/sessionDates';
import { transcriptStatus } from '../sessions/transcriptStatus';

/** Pure derivations for the Hoje screen (spec 0096 P3). No IPC, no React. */

export type DayPeriod = 'morning' | 'afternoon' | 'evening';

export function greetingPeriod(now: Date): DayPeriod {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  return 'evening';
}

function today(now: Date) {
  const start = localDay(now.getFullYear(), now.getMonth(), now.getDate());
  return { start, end: nextDay(start) };
}

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

const normalize = (title: string) => title.trim().toLocaleLowerCase();
/** A session created from an Outlook event keeps its title and start (detection, sheets). */
const PAIR_WINDOW_MS = 15 * 60_000;

export type AgendaRow = {
  key: string;
  title: string;
  /** Null for all-day events. */
  start: Date | null;
  end: Date | null;
  allDay: boolean;
  session: Session | null;
  event: CalendarEvent | null;
  people: number;
};

function peopleCount(event: CalendarEvent | null) {
  if (!event) return 0;
  const seen = new Set<string>();
  for (const p of [...event.attendees, ...(event.organizer ? [event.organizer] : [])])
    seen.add((p.email || p.name).toLocaleLowerCase());
  return seen.size;
}

/** Today's Outlook events and meeting sessions as one list, ordered by time. */
export function mergeAgenda(
  sessions: Session[],
  events: CalendarEvent[],
  now = new Date()
): AgendaRow[] {
  const { start, end } = today(now);
  const daySessions = sessions.filter((s) => {
    if (s.status === 'cancelled') return false;
    const d = sessionDate(s)?.date;
    return !!d && d >= start && d < end;
  });
  const dayEvents = events.filter((e) => {
    if (e.cancelled) return false;
    const s = parse(e.startsAt);
    if (!s) return false;
    if (e.allDay) return s < end && (parse(e.endsAt) ?? nextDay(s)) > start;
    return s >= start && s < end;
  });
  const used = new Set<string>();
  const rows: AgendaRow[] = dayEvents.map((event) => {
    const s = parse(event.startsAt);
    const match = daySessions.find((session) => {
      if (used.has(session.id) || normalize(session.title) !== normalize(event.title)) return false;
      const d = sessionDate(session)?.date;
      return event.allDay || (!!d && !!s && Math.abs(d.getTime() - s.getTime()) <= PAIR_WINDOW_MS);
    });
    if (match) used.add(match.id);
    return {
      key: match ? `s:${match.id}` : `e:${event.id}`,
      title: match?.title || event.title,
      start: event.allDay ? null : s,
      end: event.allDay ? null : parse(event.endsAt),
      allDay: event.allDay,
      session: match ?? null,
      event,
      people: peopleCount(event),
    };
  });
  for (const session of daySessions) {
    if (used.has(session.id)) continue;
    rows.push({
      key: `s:${session.id}`,
      title: session.title,
      start: sessionDate(session)?.date ?? null,
      end: parse(session.ends_at),
      allDay: false,
      session,
      event: null,
      people: 0,
    });
  }
  return rows.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0) || a.title.localeCompare(b.title);
  });
}

/** First row that starts after `now` (the live one never counts as next). */
export function nextRow(rows: AgendaRow[], now = new Date()) {
  return rows.find((r) => !r.allDay && r.start && r.start > now) ?? null;
}

export type RowAction = 'prepare' | 'open' | 'none';

export function rowAction(row: AgendaRow, now = new Date()): RowAction {
  if (row.session?.recording) return 'open';
  if (row.start && row.start > now) return 'prepare';
  return row.session ? 'open' : 'none';
}

export function hasEnded(row: AgendaRow, now = new Date()) {
  const end = row.end ?? row.start;
  return !row.allDay && !!end && end <= now;
}

const newestFirst = (a: Session, b: Session) =>
  (sessionDate(b)?.date.getTime() ?? 0) - (sessionDate(a)?.date.getTime() ?? 0);

export function isTranscriptionFailed(s: Session) {
  return s.processing_state === 'failed' && !s.processing;
}

/** A finished recording that was never transcribed and is not being processed. */
export function isMissingTranscript(s: Session) {
  const state = s.recording?.captureState;
  return (
    (state === 'finished' || state === 'interrupted') &&
    transcriptStatus(s) === 'none' &&
    !s.processing &&
    !['failed', 'running', 'pending'].includes(s.processing_state ?? '')
  );
}

export type ReviewKind = 'failed' | 'notx';
export type ReviewGroup = { kind: ReviewKind; sessions: Session[] };

/**
 * Pending reviews. "Speaker to confirm" needs a recognition read per meeting
 * (`library_recognition`), too costly for a home screen, so it is not listed.
 */
export function reviewGroups(sessions: Session[]): ReviewGroup[] {
  const groups: ReviewGroup[] = [
    { kind: 'failed', sessions: sessions.filter(isTranscriptionFailed).sort(newestFirst) },
    { kind: 'notx', sessions: sessions.filter(isMissingTranscript).sort(newestFirst) },
  ];
  return groups.filter((g) => g.sessions.length > 0);
}

export type WeekDay = { key: string; date: Date; ms: number; isToday: boolean };
export type WeekStats = {
  days: WeekDay[];
  totalMs: number;
  meetings: number;
  transcribed: number;
  failed: number;
};

/** Finished captures only: a live one has no real end yet. */
function recordedMs(s: Session) {
  const state = s.recording?.captureState;
  if (state !== 'finished' && state !== 'interrupted') return 0;
  const a = parse(s.starts_at);
  const b = parse(s.ends_at);
  return a && b && b > a ? b.getTime() - a.getTime() : 0;
}

/** Recorded time per weekday (Monday first). Weekend days show when used or when today. */
export function weekStats(sessions: Session[], now = new Date()): WeekStats {
  const range = periodRange({ kind: 'week' }, now)!;
  const todayKey = dayKey(now);
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = nextDay(range.start, i);
    return { key: dayKey(date), date, ms: 0, isToday: dayKey(date) === todayKey };
  });
  let meetings = 0;
  let transcribed = 0;
  let failed = 0;
  for (const s of sessions) {
    const d = sessionDate(s)?.date;
    if (!d || d < range.start || d >= range.end || s.status === 'cancelled') continue;
    const day = days.find((x) => x.key === dayKey(d));
    if (day) day.ms += recordedMs(s);
    if (d > now) continue;
    meetings++;
    if (transcriptStatus(s) === 'available') transcribed++;
    if (isTranscriptionFailed(s)) failed++;
  }
  const shown = days.filter((d, i) => i < 5 || d.ms > 0 || d.isToday);
  return {
    days: shown,
    totalMs: days.reduce((n, d) => n + d.ms, 0),
    meetings,
    transcribed,
    failed,
  };
}

export type PreviewCard = { item: BoardItem; fx: number; fy: number };

/** Up to four activity cards, positioned by their relative place on the board. */
export function previewCards(board: Board | null, limit = 4): PreviewCard[] {
  if (!board) return [];
  const cards = board.items
    .filter((i) => i.kind === 'card')
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, limit);
  if (!cards.length) return [];
  const xs = cards.map((c) => c.x);
  const ys = cards.map((c) => c.y);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  return cards.map((item) => ({
    item,
    fx: maxX > minX ? (item.x - minX) / (maxX - minX) : 0,
    fy: maxY > minY ? (item.y - minY) / (maxY - minY) : 0,
  }));
}

const progressOf = (i: BoardItem) => Math.max(0, Math.min(100, i.progress ?? 0));

/** The area holding the most activities, with their average progress. */
export function mainAreaProgress(board: Board | null): { label: string; pct: number } | null {
  if (!board) return null;
  let best: { label: string; cards: BoardItem[] } | null = null;
  for (const area of board.items.filter((i) => i.kind === 'area')) {
    const cards = board.items.filter((i) => i.kind === 'card' && i.parentId === area.id);
    if (cards.length && (!best || cards.length > best.cards.length))
      best = { label: area.label, cards };
  }
  if (!best) return null;
  const pct = Math.round(best.cards.reduce((n, c) => n + progressOf(c), 0) / best.cards.length);
  return { label: best.label, pct };
}

export function cardProgress(item: BoardItem) {
  return progressOf(item);
}

/** "4h 12min", "35min", "0min". */
export function formatDuration(ms: number) {
  const total = Math.round(ms / 60_000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h${m ? ` ${m}min` : ''}` : `${m}min`;
}
