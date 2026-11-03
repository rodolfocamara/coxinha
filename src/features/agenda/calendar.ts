import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { publishCategories } from './categories';
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
  /** Outlook category names, in Outlook's order (spec 0103). */
  categories?: string[];
};
/** A master-list category; `preset` is Outlook's colour 0–24, null for none. */
export type OutlookCategory = { name: string; preset: number | null };
export type CategoryAccess = { read: boolean; write: boolean };
export type CalendarSnapshot = {
  account: string | null;
  syncedAt: string | null;
  events: CalendarEvent[];
  categories?: OutlookCategory[];
  categoryAccess?: CategoryAccess;
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
/** Every snapshot read passes through here so category colours stay current. */
const published = (pending: Promise<CalendarSnapshot>) =>
  pending.then((snapshot) => {
    publishCategories(snapshot);
    return snapshot;
  });
export const calendar = {
  status: () =>
    isTauri()
      ? published(invoke<CalendarSnapshot>('calendar_status'))
      : Promise.resolve(emptyCalendar),
  begin: (clientId: string, tenant: string) =>
    invoke<{ id: string; url: string }>('calendar_begin', { clientId, tenant }),
  complete: (id: string) => published(invoke<CalendarSnapshot>('calendar_complete', { id })),
  cancel: (id?: string) => invoke<void>('calendar_cancel', { id: id ?? null }),
  sync: () => published(invoke<CalendarSnapshot>('calendar_sync')),
  disconnect: () =>
    invoke<void>('calendar_disconnect').then(() => publishCategories(emptyCalendar)),
  setCategories: (eventId: string, categories: string[]) =>
    published(invoke<CalendarSnapshot>('calendar_set_categories', { eventId, categories })),
};
