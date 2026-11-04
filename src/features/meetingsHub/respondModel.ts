import type { CalendarEvent, ResponseRequest } from '../agenda/calendar';
import { dayKey } from '../sessions/sessionDates';
import { myResponse } from './eventDetailsModel';
import { hhmm, localInstant } from './NewMeetingSheet';

export const MAX_COMMENT = 2000;

export type Choice = 'accept' | 'tentative' | 'decline' | 'propose';
export type Draft = {
  choice: Choice | null;
  proposeAs: 'tentative' | 'decline';
  scope: ResponseRequest['scope'];
  comment: string;
  notify: boolean;
  date: string;
  from: string;
  to: string;
};
export type SlotProblem = 'range' | 'past' | 'same';

/** Spec 0130 P3: only an invitee, of an event that still stands, with someone to answer to. */
export function canRespond(event: CalendarEvent) {
  const mine = myResponse(event);
  return !event.cancelled && !!event.organizer && !!mine && mine !== 'organizer';
}

export const isRecurring = (event: CalendarEvent) => !!event.seriesMasterId;
export const allowsProposals = (event: CalendarEvent) => event.allowNewTimeProposals !== false;
export const asksForResponse = (event: CalendarEvent) => event.responseRequested !== false;
export const organizerName = (event: CalendarEvent) =>
  event.organizer?.name || event.organizer?.email || '';

/** Starts on the meeting's own slot when it fits one day, else on the morning of its first day. */
export function initialDraft(event: CalendarEvent): Draft {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const oneDay = !event.allDay && dayKey(start) === dayKey(end) && end > start;
  return {
    choice: null,
    proposeAs: 'tentative',
    scope: 'occurrence',
    comment: '',
    notify: asksForResponse(event),
    date: dayKey(start),
    from: oneDay ? hhmm(start) : '09:00',
    to: oneDay ? hhmm(end) : '10:00',
  };
}

function slotOf(draft: Draft) {
  const startsAt = localInstant(draft.date, draft.from);
  const endsAt = localInstant(draft.date, draft.to);
  return draft.from && draft.to && startsAt && endsAt ? { startsAt, endsAt } : null;
}

export function slotProblem(draft: Draft, event: CalendarEvent, now: Date): SlotProblem | null {
  const slot = slotOf(draft);
  if (!slot) return 'range';
  const start = new Date(slot.startsAt).getTime();
  const end = new Date(slot.endsAt).getTime();
  if (end <= start) return 'range';
  if (start <= now.getTime()) return 'past';
  const current =
    start === new Date(event.startsAt).getTime() && end === new Date(event.endsAt).getTime();
  return current ? 'same' : null;
}

/**
 * What the draft sends, once Graph's limits apply: a proposal is never silent and
 * is for one occurrence, and a silent response has no one to read its comment.
 */
export function requestOf(draft: Draft): ResponseRequest | null {
  if (!draft.choice) return null;
  const proposing = draft.choice === 'propose';
  const notify = proposing || draft.notify;
  return {
    kind: draft.choice === 'propose' ? draft.proposeAs : draft.choice,
    scope: proposing ? 'occurrence' : draft.scope,
    comment: (notify && draft.comment.trim()) || null,
    notify,
    proposed: proposing ? slotOf(draft) : null,
  };
}

/** The computer's zone, the one the whole agenda uses: "America/Sao_Paulo (GMT-3)". */
export function ownerZone(at: Date, locale: string) {
  const { timeZone } = new Intl.DateTimeFormat().resolvedOptions();
  const short = new Intl.DateTimeFormat(locale, { timeZoneName: 'short' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value;
  return short && short !== timeZone ? `${timeZone} (${short})` : timeZone;
}
