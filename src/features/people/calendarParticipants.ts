import type { CalendarSnapshot } from '../agenda/calendar';
import { nameKey } from '../meetings/personChoices';

export type CalendarParticipant = {
  key: string;
  name: string;
  email: string | null;
  meetings: number;
};

/**
 * Everyone invited to the cached events, once per name (people have no
 * e-mail), without the connected account and existing people (spec 0110 P4).
 */
export function calendarParticipants(
  snapshot: CalendarSnapshot,
  existingNames: string[]
): CalendarParticipant[] {
  const account = snapshot.account?.trim().toLowerCase() || null;
  const existing = new Set(existingNames.map(nameKey));
  const found = new Map<string, { name: string; email: string | null; events: Set<string> }>();
  for (const event of snapshot.events) {
    if (event.cancelled) continue;
    for (const person of [...(event.organizer ? [event.organizer] : []), ...event.attendees]) {
      const name = person.name.trim().replace(/\s+/g, ' ');
      const key = nameKey(name);
      const email = person.email?.trim().toLowerCase() || null;
      if (!key || (email && email === account) || existing.has(key)) continue;
      const entry = found.get(key) ?? { name, email, events: new Set<string>() };
      entry.email ??= email;
      entry.events.add(event.id);
      found.set(key, entry);
    }
  }
  return [...found.entries()]
    .map(([key, { name, email, events }]) => ({ key, name, email, meetings: events.size }))
    .sort((a, b) => b.meetings - a.meetings || a.name.localeCompare(b.name));
}
