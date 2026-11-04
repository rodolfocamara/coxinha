import { expect, it } from 'vitest';
import type { AttendeeResponse } from '../agenda/calendar';
import { attendeeGroups, eventLook, myResponse } from './eventDetailsModel';
import { event } from './meetingsHub.fixtures';

const person = (
  name: string,
  response: AttendeeResponse['response'],
  kind: AttendeeResponse['kind'] = 'required'
): AttendeeResponse => ({ name, email: null, response, kind });
const invited = { attendees: [{ name: 'Ana', email: null }] };

it('follows Outlook: declined wins over tentative, and tentative over free', () => {
  const look = (o: Parameters<typeof event>[0] extends infer T ? Partial<T> : never) =>
    eventLook(event({ id: 'e', title: 'x', ...o }));
  expect(look({})).toBeNull();
  expect(look({ showAs: 'busy', response: 'accepted' })).toBeNull();
  expect(look({ showAs: 'free' })).toBe('free');
  expect(look({ showAs: 'tentative' })).toBe('tentative');
  expect(look({ response: 'tentativelyAccepted', showAs: 'free' })).toBe('tentative');
  expect(look({ response: 'declined', showAs: 'tentative' })).toBe('declined');
  expect(eventLook(null)).toBeNull();
});

it('says my response only when someone asked', () => {
  const mine = (o: object) => myResponse(event({ id: 'e', title: 'x', ...invited, ...o }));
  expect(mine({ response: 'accepted' })).toBe('accepted');
  expect(mine({ response: 'tentativelyAccepted' })).toBe('tentative');
  expect(mine({ response: 'declined' })).toBe('declined');
  expect(mine({ response: 'notResponded' })).toBe('none');
  expect(mine({ response: 'none' })).toBe('none');
  expect(mine({ response: 'accepted', isOrganizer: true })).toBe('organizer');
  expect(mine({})).toBeNull();
  expect(myResponse(event({ id: 'e', title: 'Lunch', response: 'organizer' }))).toBeNull();
});

it('groups invitees by response with required and optional counts, without rooms', () => {
  const details = attendeeGroups(
    event({
      id: 'e',
      title: 'x',
      attendeeResponses: [
        person('Ana', 'accepted'),
        person('Chefe', 'organizer'),
        person('Bruno', 'tentativelyAccepted', 'optional'),
        person('Carla', 'declined'),
        person('Davi', 'notResponded', 'optional'),
        person('Edu', 'none'),
        person('Fê', null, null),
        person('Room 4', 'accepted', 'resource'),
      ],
    })
  )!;
  expect(details.total).toBe(7);
  expect(details.required).toBe(5);
  expect(details.optional).toBe(2);
  expect(details.groups.map((g) => [g.id, g.people.map((p) => p.name)])).toEqual([
    ['accepted', ['Ana', 'Chefe']],
    ['tentative', ['Bruno']],
    ['declined', ['Carla']],
    ['noAnswer', ['Davi', 'Edu', 'Fê']],
  ]);
});

it('leaves out empty groups and claims none for a cache without responses', () => {
  const only = attendeeGroups(
    event({ id: 'e', title: 'x', attendeeResponses: [person('Ana', 'accepted')] })
  )!;
  expect(only.groups.map((g) => g.id)).toEqual(['accepted']);
  expect(attendeeGroups(event({ id: 'e', title: 'x', ...invited }))).toBeNull();
});
