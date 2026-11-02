import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
export type Candidate = { name: string; email: string | null };
export type CalendarEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  cancelled: boolean;
  allDay: boolean;
  attendees: Candidate[];
  organizer?: Candidate | null;
  seriesMasterId?: string | null;
  eventType?: string | null;
  originalStart?: string | null;
};
export type CalendarSnapshot = {
  account: string | null;
  syncedAt: string | null;
  events: CalendarEvent[];
};
/** Emitted whenever the backend rewrites or clears the Outlook cache. */
export const CALENDAR_CHANGED = 'calendar-changed';

/** Subscribe to cache changes; returns the unsubscribe function. */
export function onCalendarChanged(handler: () => void): () => void {
  if (!isTauri()) return () => {};
  const pending = listen(CALENDAR_CHANGED, handler).catch(() => null);
  return () => void pending.then((stop) => stop?.());
}
export const emptyCalendar: CalendarSnapshot = { account: null, syncedAt: null, events: [] };
export const calendar = {
  status: () =>
    isTauri() ? invoke<CalendarSnapshot>('calendar_status') : Promise.resolve(emptyCalendar),
  begin: (clientId: string, tenant: string) =>
    invoke<{ id: string; url: string }>('calendar_begin', { clientId, tenant }),
  complete: (id: string) => invoke<CalendarSnapshot>('calendar_complete', { id }),
  cancel: (id?: string) => invoke<void>('calendar_cancel', { id: id ?? null }),
  sync: () => invoke<CalendarSnapshot>('calendar_sync'),
  disconnect: () => invoke<void>('calendar_disconnect'),
};
