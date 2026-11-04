import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { publishCategories } from './categories';
export type Candidate = { name: string; email: string | null };
export type EventResponse =
  | 'none'
  | 'organizer'
  | 'tentativelyAccepted'
  | 'accepted'
  | 'declined'
  | 'notResponded';
export type AttendeeResponse = Candidate & {
  response: EventResponse | null;
  kind: 'required' | 'optional' | 'resource' | null;
};
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
  /** Spec 0124 P1; absent in a cache from before it. */
  response?: EventResponse | null;
  attendeeResponses?: AttendeeResponse[];
  location?: string | null;
  joinUrl?: string | null;
  bodyPreview?: string | null;
  showAs?: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere' | 'unknown' | null;
  isOrganizer?: boolean;
  webLink?: string | null;
  /** Spec 0130 P2; absent in a cache from before it, which Graph's default reads as true. */
  allowNewTimeProposals?: boolean | null;
  responseRequested?: boolean | null;
};
/** Spec 0130: an answer to an invitation. Slots are UTC instants. */
export type ResponseRequest = {
  kind: 'accept' | 'tentative' | 'decline';
  scope: 'occurrence' | 'series';
  comment: string | null;
  notify: boolean;
  proposed: { startsAt: string; endsAt: string } | null;
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

const inPage = new Set<() => void>();

/** Subscribe to cache changes; returns the unsubscribe function. */
export function onCalendarChanged(handler: () => void): () => void {
  if (!isTauri()) return () => {};
  inPage.add(handler);
  const pending = listen(CALENDAR_CHANGED, handler).catch(() => null);
  return () => {
    inPage.delete(handler);
    void pending.then((stop) => stop?.());
  };
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
  begin: (clientId: string, tenant: string, directoryPhotos = false) =>
    invoke<{ id: string; url: string }>('calendar_begin', { clientId, tenant, directoryPhotos }),
  complete: (id: string) => published(invoke<CalendarSnapshot>('calendar_complete', { id })),
  cancel: (id?: string) => invoke<void>('calendar_cancel', { id: id ?? null }),
  /** Spec 0124 P2: the backend opens it, and checks the URL again first. */
  openLink: (eventId: string, link: 'join' | 'outlook') =>
    invoke<void>('calendar_open_link', { eventId, link }),
  sync: () => published(invoke<CalendarSnapshot>('calendar_sync')),
  disconnect: () =>
    invoke<void>('calendar_disconnect').then(() => publishCategories(emptyCalendar)),
  setCategories: (eventId: string, categories: string[]) =>
    published(invoke<CalendarSnapshot>('calendar_set_categories', { eventId, categories })),
  /** Spec 0104 P5: subject and times only, nobody invited; `transactionId` dedupes retries. */
  createEvent: (subject: string, startsAt: string, endsAt: string, transactionId: string) =>
    published(
      invoke<CalendarSnapshot>('calendar_create_event', {
        subject,
        startsAt,
        endsAt,
        transactionId,
      })
    ),
  /** Spec 0130 P6: open views show the answer at once, before the backend's event arrives. */
  respond: (eventId: string, request: ResponseRequest) =>
    published(invoke<CalendarSnapshot>('calendar_respond', { eventId, request })).then(
      (snapshot) => {
        for (const handler of [...inPage]) handler();
        return snapshot;
      }
    ),
};
