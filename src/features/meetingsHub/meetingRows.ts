import type { CalendarEvent } from '../agenda/calendar';
import type { LibraryMeeting } from '../meetings/library';
import type { Session } from '../sessions/sessions';
import { dayKey, nextDay, localDay, recordingInstant, sessionDate } from '../sessions/sessionDates';
import { transcriptStatus } from '../sessions/transcriptStatus';

/**
 * One line of the Reuniões list (spec 0096 P4). Sessions are the meetings the
 * user owns; Outlook events appear only until a session exists for them;
 * recordings appear only when no session points at them.
 */
export type MeetingRow =
  | {
      kind: 'session';
      key: string;
      title: string;
      start: Date | null;
      end: Date | null;
      session: Session;
      event: CalendarEvent | null;
    }
  | {
      kind: 'event';
      key: string;
      title: string;
      start: Date | null;
      end: Date | null;
      event: CalendarEvent;
    }
  | {
      kind: 'recording';
      key: string;
      title: string;
      start: Date | null;
      end: null;
      recording: LibraryMeeting;
    };

export type GroupId = 'now' | 'today' | 'upcoming' | 'earlier';
export const GROUPS: GroupId[] = ['now', 'today', 'upcoming', 'earlier'];

/** What the meeting waits for. Only the first three put it under "A revisar". */
export type Attention = 'recover' | 'failed' | 'untranscribed' | 'processing' | null;

export const rowKey = {
  session: (id: string) => `s:${id}`,
  event: (id: string) => `e:${id}`,
  recording: (id: string) => `r:${id}`,
};

const date = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

export function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

const MATCH_WINDOW_MS = 30 * 60_000;

/**
 * Sessions carry no event ID, so a session belongs to an event when it has the
 * same title and starts within 30 minutes of it (sessions created from an
 * event copy both), or when start and end are identical.
 */
export function matchEvent(session: Session, events: CalendarEvent[]): CalendarEvent | null {
  const start = date(session.starts_at);
  if (!start) return null;
  const title = normalize(session.title);
  const end = date(session.ends_at);
  return (
    events.find((event) => {
      const eventStart = date(event.startsAt);
      if (!eventStart) return false;
      const gap = Math.abs(eventStart.getTime() - start.getTime());
      if (normalize(event.title) === title && gap <= MATCH_WINDOW_MS) return true;
      const eventEnd = date(event.endsAt);
      return gap === 0 && !!end && !!eventEnd && eventEnd.getTime() === end.getTime();
    }) ?? null
  );
}

export function buildRows(
  sessions: Session[],
  events: CalendarEvent[],
  recordings: LibraryMeeting[]
): MeetingRow[] {
  const claimed = new Set<string>();
  const rows: MeetingRow[] = sessions.map((session) => {
    const event = matchEvent(
      session,
      events.filter((e) => !claimed.has(e.id))
    );
    if (event) claimed.add(event.id);
    return {
      kind: 'session',
      key: rowKey.session(session.id),
      title: session.title,
      start: sessionDate(session)?.date ?? null,
      end: date(session.ends_at),
      session,
      event,
    };
  });
  for (const event of events)
    if (!claimed.has(event.id))
      rows.push({
        kind: 'event',
        key: rowKey.event(event.id),
        title: event.title,
        start: date(event.startsAt),
        end: date(event.endsAt),
        event,
      });
  const owned = new Set(sessions.map((s) => s.meeting_id).filter(Boolean));
  for (const recording of recordings)
    if (!owned.has(recording.id))
      rows.push({
        kind: 'recording',
        key: rowKey.recording(recording.id),
        title: recording.title,
        start: recordingInstant(recording.createdAt),
        end: null,
        recording,
      });
  return rows;
}

export function groupOf(row: MeetingRow, now: Date, live: boolean): GroupId {
  if (live) return 'now';
  const { start, end } = row;
  if (!start) return 'earlier';
  if (start <= now && end && now < end) return 'now';
  const today = localDay(now.getFullYear(), now.getMonth(), now.getDate());
  if (start < today) return 'earlier';
  if (start < nextDay(today)) return 'today';
  return 'upcoming';
}

export function groupRows(
  rows: MeetingRow[],
  now: Date,
  isLive: (row: MeetingRow) => boolean
): { id: GroupId; rows: MeetingRow[] }[] {
  const groups = new Map<GroupId, MeetingRow[]>(GROUPS.map((id) => [id, []]));
  for (const row of rows) groups.get(groupOf(row, now, isLive(row)))!.push(row);
  const time = (row: MeetingRow) => row.start?.getTime() ?? null;
  const ascending = (a: MeetingRow, b: MeetingRow) =>
    (time(a) ?? Infinity) - (time(b) ?? Infinity) || a.key.localeCompare(b.key);
  return GROUPS.map((id) => ({
    id,
    rows: [...groups.get(id)!].sort(
      id === 'earlier'
        ? (a, b) => (time(b) ?? -Infinity) - (time(a) ?? -Infinity) || a.key.localeCompare(b.key)
        : ascending
    ),
  })).filter((group) => group.rows.length > 0);
}

export function attentionOf(row: MeetingRow, live: boolean): Attention {
  if (live || row.kind === 'event') return null;
  if (row.kind === 'recording')
    return ['recording', 'interrupted'].includes(row.recording.captureState) ? 'recover' : null;
  const { session } = row;
  const capture = session.recording?.captureState;
  if (capture === 'recording' || capture === 'interrupted') return 'recover';
  if (session.processing || ['queued', 'running'].includes(String(session.processing_state)))
    return 'processing';
  const transcript = transcriptStatus(session);
  if (session.processing_state === 'failed' && transcript !== 'available') return 'failed';
  if (capture === 'finished' && (transcript === 'none' || transcript === 'empty'))
    return 'untranscribed';
  return null;
}

export const needsReview = (attention: Attention) =>
  attention === 'recover' || attention === 'failed' || attention === 'untranscribed';

export function matchesSearch(row: MeetingRow, query: string) {
  const q = normalize(query);
  if (!q) return true;
  const event = row.kind === 'recording' ? null : row.event;
  const haystack = [
    row.title,
    ...(event?.attendees ?? []).flatMap((a) => [a.name, a.email ?? '']),
    event?.organizer?.name ?? '',
    event?.organizer?.email ?? '',
  ];
  return haystack.some((value) => normalize(value).includes(q));
}

/** Rows per local civil day, for the month grid. Undated rows are not placed. */
export function rowsByDay(rows: MeetingRow[]) {
  const days = new Map<string, MeetingRow[]>();
  for (const row of rows) {
    if (!row.start) continue;
    const key = dayKey(row.start);
    days.set(key, [...(days.get(key) ?? []), row]);
  }
  for (const list of days.values())
    list.sort((a, b) => a.start!.getTime() - b.start!.getTime() || a.key.localeCompare(b.key));
  return days;
}

/** Scheduled length of a recorded session, when both ends are known. */
export function scheduledMs(row: MeetingRow) {
  if (!row.start || !row.end) return null;
  const ms = row.end.getTime() - row.start.getTime();
  return ms > 0 ? ms : null;
}

export function attendeesOf(row: MeetingRow) {
  return row.kind === 'recording' ? [] : (row.event?.attendees ?? []);
}
