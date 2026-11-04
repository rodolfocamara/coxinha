/** Data factories for Reuniões tests (no app imports, safe in pure tests). */
import type { Session } from '../sessions/sessions';
import type { CalendarEvent } from '../agenda/calendar';
import type { LibraryMeeting } from '../meetings/library';

/** Local wall-clock time relative to today, as the UTC instant the backend stores. */
export function at(offsetDays: number, hours: number, minutes = 0) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays, hours, minutes);
  return d.toISOString().slice(0, 19) + 'Z';
}
/** An instant `minutes` away from now (negative = past). */
export function fromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString().slice(0, 19) + 'Z';
}

export function session(o: Partial<Session> & { id: string; title: string }): Session {
  return {
    starts_at: null,
    ends_at: null,
    status: 'planned',
    origin: 'manual',
    meeting_id: null,
    personal_note: null,
    created_at: at(-1, 9),
    note_error: null,
    transcript_status: 'none',
    processing_state: null,
    processing: null,
    recording: null,
    ...o,
  };
}
export const recording = (
  id: string,
  title: string,
  captureState: LibraryMeeting['captureState'] = 'finished',
  createdAt = at(-2, 11)
): LibraryMeeting => ({ id, title, captureState, createdAt });

export function event(o: Partial<CalendarEvent> & { id: string; title: string }): CalendarEvent {
  return {
    startsAt: at(1, 9),
    endsAt: at(1, 10),
    cancelled: false,
    allDay: false,
    attendees: [],
    organizer: null,
    ...o,
  };
}
