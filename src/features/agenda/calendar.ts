import { invoke, isTauri } from '@tauri-apps/api/core';
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
