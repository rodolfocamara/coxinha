import type { ParticipantCandidate, ProcessingDetail } from './library';

export type Person = ProcessingDetail['people'][number];
export type Choice =
  | { kind: 'person'; id: string; label: string; person: Person; invitee: boolean }
  | { kind: 'invitee'; id: string; label: string; invitee: ParticipantCandidate };
/** What a typed or picked name stands for when the owner confirms. */
export type Pick = Choice | { kind: 'new'; id: string; label: string };

/** Case, accents and spacing ignored (`name_key` in coxinha-core). */
export function nameKey(name: string) {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

/** Invitees first, as the existing person of the same name when there is one (spec 0102). */
export function personChoices(people: Person[], invitees: ParticipantCandidate[]): Choice[] {
  const first: Choice[] = [];
  const seen = new Set<string>();
  invitees.forEach((invitee, index) => {
    const name = nameKey(invitee.name);
    if (!name || seen.has(name)) return;
    seen.add(name);
    const person = people.find((p) => nameKey(p.name) === name);
    first.push(
      person
        ? {
            kind: 'person',
            id: person.id,
            label: personLabel(person, people),
            person,
            invitee: true,
          }
        : { kind: 'invitee', id: `invitee:${index}`, label: invitee.name.trim(), invitee }
    );
  });
  const listed = new Set(first.map((c) => c.id));
  return [
    ...first,
    ...people
      .filter((p) => !listed.has(p.id))
      .map(
        (person): Choice => ({
          kind: 'person',
          id: person.id,
          label: personLabel(person, people),
          person,
          invitee: false,
        })
      ),
  ];
}

export function matchChoices(choices: Choice[], text: string): Choice[] {
  const needle = nameKey(text);
  if (!needle) return choices;
  return choices.filter(
    (c) =>
      nameKey(c.label).includes(needle) ||
      (c.kind === 'invitee' && !!c.invitee.email && nameKey(c.invitee.email).includes(needle))
  );
}

/**
 * The typed text as a pick: the one choice of that exact name, a new person
 * when nobody has it, or nothing when it is empty or names homonyms.
 */
export function resolveTyped(choices: Choice[], text: string): Pick | null {
  const key = nameKey(text);
  if (!key) return null;
  const byLabel = choices.filter((c) => nameKey(c.label) === key);
  if (byLabel.length === 1) return byLabel[0];
  const byName = choices.filter(
    (c) => nameKey(c.kind === 'person' ? c.person.name : c.invitee.name) === key
  );
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) return null;
  return { kind: 'new', id: `new:${key}`, label: text.trim().replace(/\s+/g, ' ') };
}

function personLabel(person: Person, people: Person[]) {
  const homonyms = people.filter((p) => nameKey(p.name) === nameKey(person.name));
  if (homonyms.length < 2) return person.name;
  const shortId = person.id.slice(-8);
  const unique = homonyms.every((p) => p.id === person.id || p.id.slice(-8) !== shortId);
  return `${person.name} (${unique ? shortId : person.id})`;
}

/** Calendar invitees, then stored participants, once each by e-mail, then name. */
export function mergeParticipants(...lists: ParticipantCandidate[][]): ParticipantCandidate[] {
  const all: ParticipantCandidate[] = [];
  for (const person of lists.flat()) {
    if (!nameKey(person.name)) continue;
    const same = (other: ParticipantCandidate) =>
      person.email && other.email
        ? person.email.toLowerCase() === other.email.toLowerCase()
        : nameKey(person.name) === nameKey(other.name);
    if (!all.some(same)) all.push(person);
  }
  return all;
}
