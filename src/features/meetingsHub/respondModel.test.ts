import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../agenda/calendar';
import {
  allowsProposals,
  asksForResponse,
  canRespond,
  initialDraft,
  ownerZone,
  requestOf,
  slotProblem,
  type Draft,
} from './respondModel';
import { localInstant } from './NewMeetingSheet';

const local = (date: string, time: string) => localInstant(date, time)!;
const invite = (o: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e',
  title: 'Sync',
  startsAt: local('2026-11-05', '14:00'),
  endsAt: local('2026-11-05', '15:00'),
  cancelled: false,
  allDay: false,
  attendees: [{ name: 'Owner', email: 'o@example.test' }],
  organizer: { name: 'Host', email: 'h@example.test' },
  response: 'notResponded',
  ...o,
});
const now = new Date(2026, 10, 4, 12);
const draft = (o: Partial<Draft> = {}): Draft => ({ ...initialDraft(invite()), ...o });

describe('who can respond', () => {
  it.each([
    ['not answered', {}],
    ['none', { response: 'none' as const }],
    ['accepted', { response: 'accepted' as const }],
    ['tentative', { response: 'tentativelyAccepted' as const }],
    ['declined', { response: 'declined' as const }],
  ])('an invitee who has %s', (_, change) => {
    expect(canRespond(invite(change))).toBe(true);
  });
  it.each([
    ['the organizer', { isOrganizer: true }],
    ['the organizer, by response', { response: 'organizer' as const }],
    ['a cancelled event', { cancelled: true }],
    ['a personal block', { attendees: [] }],
    ['no organizer', { organizer: null }],
    ['a cache from before responses', { response: null }],
  ])('not %s', (_, change) => {
    expect(canRespond(invite(change))).toBe(false);
  });
});

describe('what Graph allows', () => {
  it('reads an absent value as its documented default', () => {
    expect(allowsProposals(invite())).toBe(true);
    expect(allowsProposals(invite({ allowNewTimeProposals: false }))).toBe(false);
    expect(asksForResponse(invite())).toBe(true);
    expect(asksForResponse(invite({ responseRequested: false }))).toBe(false);
    expect(initialDraft(invite({ responseRequested: false })).notify).toBe(false);
  });
});

describe('the first draft', () => {
  it('starts with no answer chosen, on this occurrence, on the meeting slot', () => {
    expect(draft()).toMatchObject({
      choice: null,
      scope: 'occurrence',
      notify: true,
      date: '2026-11-05',
      from: '14:00',
      to: '15:00',
    });
    expect(requestOf(draft())).toBeNull();
  });
  it('uses a morning when the meeting does not fit one day', () => {
    const allDay = invite({ allDay: true, endsAt: local('2026-11-06', '00:00') });
    expect(initialDraft(allDay)).toMatchObject({ from: '09:00', to: '10:00' });
  });
});

describe('the request', () => {
  it('sends a plain answer as chosen, with a trimmed comment', () => {
    expect(requestOf(draft({ choice: 'accept', comment: '  Thanks!  ', scope: 'series' }))).toEqual(
      { kind: 'accept', scope: 'series', comment: 'Thanks!', notify: true, proposed: null }
    );
  });
  it('drops the comment of a silent answer', () => {
    expect(requestOf(draft({ choice: 'decline', comment: 'x', notify: false }))).toEqual({
      kind: 'decline',
      scope: 'occurrence',
      comment: null,
      notify: false,
      proposed: null,
    });
  });
  it('sends a proposal notified, for this occurrence, as UTC instants', () => {
    const request = requestOf(
      draft({
        choice: 'propose',
        proposeAs: 'decline',
        notify: false,
        scope: 'series',
        date: '2026-11-06',
        from: '10:00',
        to: '11:30',
      })
    );
    expect(request).toEqual({
      kind: 'decline',
      scope: 'occurrence',
      comment: null,
      notify: true,
      proposed: {
        startsAt: new Date(2026, 10, 6, 10).toISOString().replace('.000', ''),
        endsAt: new Date(2026, 10, 6, 11, 30).toISOString().replace('.000', ''),
      },
    });
  });
});

describe('a proposed slot', () => {
  const problem = (o: Partial<Draft>) =>
    slotProblem(draft({ choice: 'propose', ...o }), invite(), now);
  it('must differ from the current time', () => {
    expect(problem({})).toBe('same');
  });
  it('accepts another time', () => {
    expect(problem({ date: '2026-11-06' })).toBeNull();
    expect(problem({ from: '14:30' })).toBeNull();
  });
  it('must end after it starts', () => {
    expect(problem({ from: '15:00', to: '15:00' })).toBe('range');
    expect(problem({ from: '16:00', to: '15:00' })).toBe('range');
    expect(problem({ to: '' })).toBe('range');
    expect(problem({ date: '' })).toBe('range');
  });
  it('must not be in the past', () => {
    expect(problem({ date: '2026-11-03' })).toBe('past');
  });
});

describe('the zone', () => {
  it('names the computer zone', () => {
    const { timeZone } = new Intl.DateTimeFormat().resolvedOptions();
    expect(ownerZone(now, 'en')).toContain(timeZone);
  });
});
