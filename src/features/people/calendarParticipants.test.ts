import { expect, it } from 'vitest';
import type { CalendarEvent } from '../agenda/calendar';
import { calendarParticipants } from './calendarParticipants';

const event = (id: string, attendees: CalendarEvent['attendees'], extra = {}): CalendarEvent => ({
  id,
  title: id,
  startsAt: '2026-11-03T12:00:00Z',
  endsAt: '2026-11-03T13:00:00Z',
  cancelled: false,
  allDay: false,
  attendees,
  ...extra,
});

it('lists each invitee once by name, most frequent first, without the account or existing people', () => {
  const snapshot = {
    account: 'Me@Corp.com',
    syncedAt: null,
    events: [
      event('a', [
        { name: 'Me', email: 'me@corp.com' },
        { name: 'Carla Dias', email: 'carla@corp.com' },
        { name: 'Ana Souza', email: 'ana@corp.com' },
      ]),
      event('b', [{ name: 'carla  dias', email: null }], {
        organizer: { name: 'Bruno', email: 'bruno@corp.com' },
      }),
      event('c', [{ name: 'Zé', email: 'ze@corp.com' }], { cancelled: true }),
    ],
  };
  expect(calendarParticipants(snapshot, ['ANA SOUZA'])).toEqual([
    { key: 'carla dias', name: 'Carla Dias', email: 'carla@corp.com', meetings: 2 },
    { key: 'bruno', name: 'Bruno', email: 'bruno@corp.com', meetings: 1 },
  ]);
});
