import type { AttendeeResponse, CalendarEvent } from '../agenda/calendar';

/** How a block follows Outlook (spec 0124 P3). The owner's "no" says the most. */
export type EventLook = 'declined' | 'tentative' | 'free';

export function eventLook(event: CalendarEvent | null | undefined): EventLook | null {
  if (!event) return null;
  if (event.response === 'declined') return 'declined';
  if (event.showAs === 'tentative' || event.response === 'tentativelyAccepted') return 'tentative';
  return event.showAs === 'free' ? 'free' : null;
}

export type MyResponse = 'organizer' | 'accepted' | 'tentative' | 'declined' | 'none';

/** Null on a personal block: nobody asked the owner anything. */
export function myResponse(event: CalendarEvent): MyResponse | null {
  if (!event.attendees.length) return null;
  if (event.isOrganizer || event.response === 'organizer') return 'organizer';
  switch (event.response) {
    case 'accepted':
      return 'accepted';
    case 'tentativelyAccepted':
      return 'tentative';
    case 'declined':
      return 'declined';
    case 'none':
    case 'notResponded':
      return 'none';
    default:
      return null;
  }
}

export type AttendeeGroupId = 'accepted' | 'tentative' | 'declined' | 'noAnswer';
const ORDER: AttendeeGroupId[] = ['accepted', 'tentative', 'declined', 'noAnswer'];

const groupOf = (person: AttendeeResponse): AttendeeGroupId => {
  switch (person.response) {
    case 'accepted':
    case 'organizer':
      return 'accepted';
    case 'tentativelyAccepted':
      return 'tentative';
    case 'declined':
      return 'declined';
    default:
      return 'noAnswer';
  }
};

/**
 * Invitees by response, rooms left out. Null for a cache from before spec
 * 0124: it has names without responses, and must not read as "no answer".
 */
export function attendeeGroups(event: CalendarEvent) {
  const responses = event.attendeeResponses ?? [];
  if (!responses.length) return null;
  const people = responses.filter((person) => person.kind !== 'resource');
  const optional = people.filter((person) => person.kind === 'optional').length;
  return {
    total: people.length,
    required: people.length - optional,
    optional,
    groups: ORDER.map((id) => ({
      id,
      people: people.filter((person) => groupOf(person) === id),
    })).filter((group) => group.people.length > 0),
  };
}
