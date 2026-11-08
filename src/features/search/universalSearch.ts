import { invoke } from '@tauri-apps/api/core';
import type { SearchField } from '../meetings/library';
import { normalize } from '../meetingsHub/meetingRows';

export type SearchMatch = { field: SearchField; snippet: string; atMs?: number };
export type MeetingHit = {
  id: string;
  title: string;
  startsAt: string | null;
  matches: SearchMatch[];
};
export type NoteHit = {
  id: string;
  title: string;
  snippet: string | null;
  tier: number;
  activity: boolean;
};
export type PersonHit = { id: string; name: string; alias: string | null; tier: number };
/** `universal_search` (spec 0122): each kind already ranked and bounded. */
export type UniversalAnswer = {
  notes: NoteHit[];
  meetings: MeetingHit[];
  events: MeetingHit[];
  people: PersonHit[];
};

export const universalSearch = (query: string) =>
  invoke<UniversalAnswer>('universal_search', { query, limit: 20 });

export type ResultKind = 'notes' | 'meetings' | 'transcripts' | 'people';
export const KIND_ORDER: ResultKind[] = ['notes', 'meetings', 'transcripts', 'people'];
export const PER_KIND = 6;
export const MIN_QUERY = 2;

export type Target =
  | { view: 'note'; noteId: string }
  | { view: 'session'; sessionId: string }
  | { view: 'event'; eventId: string }
  | { view: 'transcript'; sessionId: string; find: string }
  | { view: 'person'; personId: string; name: string };

export type SearchItem = {
  key: string;
  kind: ResultKind;
  label: string;
  detail?: string;
  /** ISO start of a meeting. */
  date?: string | null;
  atMs?: number;
  activity?: boolean;
  tier: number;
  target: Target;
};
export type SearchGroup = { kind: ResultKind; items: SearchItem[] };

/** 0 when the title starts with the query, 1 when it contains it. */
export function titleTier(title: string, query: string): 0 | 1 | null {
  const text = normalize(title);
  const q = normalize(query);
  if (!q) return null;
  return text.startsWith(q) ? 0 : text.includes(q) ? 1 : null;
}

/** Spec 0122 P3, the same tiers the backend sorts by. */
export function meetingTier(hit: MeetingHit, query: string, fields = hit.matches) {
  const tiers = fields.map((m) =>
    m.field === 'title'
      ? (titleTier(hit.title, query) ?? 1)
      : m.field === 'people' || m.field === 'category'
        ? 2
        : m.field === 'transcript'
          ? 4
          : 3
  );
  return tiers.length ? Math.min(...tiers) : Infinity;
}

const isMeetingNote = (path?: string) => !!path?.startsWith('notes/session-');

type LocalNote = { id: string; title: string; path?: string };

function noteItems(
  query: string,
  local: LocalNote[],
  answer: UniversalAnswer | null,
  untitled: string
) {
  const items = new Map<string, SearchItem>();
  for (const hit of answer?.notes ?? [])
    items.set(hit.id, {
      key: `note-${hit.id}`,
      kind: 'notes',
      label: hit.title || untitled,
      detail: hit.snippet ?? undefined,
      activity: hit.activity,
      tier: hit.tier,
      target: { view: 'note', noteId: hit.id },
    });
  // Titles already in memory answer before the backend does.
  for (const note of local) {
    if (isMeetingNote(note.path)) continue;
    const tier = titleTier(note.title || untitled, query);
    if (tier === null) continue;
    const known = items.get(note.id);
    if (known) known.tier = Math.min(known.tier, tier);
    else
      items.set(note.id, {
        key: `note-${note.id}`,
        kind: 'notes',
        label: note.title || untitled,
        tier,
        target: { view: 'note', noteId: note.id },
      });
  }
  return [...items.values()].sort((a, b) => a.tier - b.tier);
}

function meetingItems(query: string, answer: UniversalAnswer | null, now: Date) {
  const distance = (item: SearchItem) =>
    item.date ? Math.abs(new Date(item.date).getTime() - now.getTime()) : Infinity;
  const items: SearchItem[] = [];
  const add = (hit: MeetingHit, target: Target) => {
    const fields = hit.matches.filter((m) => m.field !== 'transcript');
    if (!fields.length) return;
    items.push({
      key: `${target.view}-${hit.id}`,
      kind: 'meetings',
      label: hit.title,
      detail: fields.find((m) => m.field !== 'title')?.snippet,
      date: hit.startsAt,
      tier: meetingTier(hit, query, fields),
      target,
    });
  };
  for (const hit of answer?.meetings ?? []) add(hit, { view: 'session', sessionId: hit.id });
  for (const hit of answer?.events ?? []) add(hit, { view: 'event', eventId: hit.id });
  return items.sort((a, b) => a.tier - b.tier || distance(a) - distance(b));
}

function transcriptItems(query: string, answer: UniversalAnswer | null): SearchItem[] {
  return (answer?.meetings ?? []).flatMap((hit) => {
    const match = hit.matches.find((m) => m.field === 'transcript');
    if (!match) return [];
    return [
      {
        key: `transcript-${hit.id}`,
        kind: 'transcripts' as const,
        label: hit.title,
        detail: match.snippet,
        date: hit.startsAt,
        atMs: match.atMs,
        tier: 4,
        target: { view: 'transcript' as const, sessionId: hit.id, find: query.trim() },
      },
    ];
  });
}

function peopleItems(answer: UniversalAnswer | null): SearchItem[] {
  return (answer?.people ?? []).map((hit) => ({
    key: `person-${hit.id}`,
    kind: 'people',
    label: hit.name,
    detail: hit.alias ?? undefined,
    tier: hit.tier,
    target: { view: 'person', personId: hit.id, name: hit.name },
  }));
}

/**
 * Spec 0122 P3: one list grouped by kind, each kind ranked and cut to
 * `PER_KIND`, kinds ordered by their best tier and then by `KIND_ORDER`.
 */
export function buildGroups(
  query: string,
  local: LocalNote[],
  answer: UniversalAnswer | null,
  now: Date,
  untitled: string
): SearchGroup[] {
  if (!normalize(query)) return [];
  const groups: SearchGroup[] = [
    { kind: 'notes', items: noteItems(query, local, answer, untitled) },
    { kind: 'meetings', items: meetingItems(query, answer, now) },
    { kind: 'transcripts', items: transcriptItems(query, answer) },
    { kind: 'people', items: peopleItems(answer) },
  ];
  return groups
    .map((g) => ({ ...g, items: g.items.slice(0, PER_KIND) }))
    .filter((g) => g.items.length > 0)
    .sort(
      (a, b) =>
        a.items[0].tier - b.items[0].tier || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    );
}

/** Text split around accent- and case-insensitive occurrences of `query`. */
export function highlight(text: string, query: string): { text: string; hit: boolean }[] {
  const chars = Array.from(text);
  const folded = chars.map((c) => normalize(c) || c);
  const needle = Array.from(normalize(query));
  if (!needle.length) return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  let from = 0;
  for (let i = 0; i <= folded.length - needle.length; ) {
    if (needle.every((c, j) => folded[i + j] === c)) {
      if (i > from) parts.push({ text: chars.slice(from, i).join(''), hit: false });
      parts.push({ text: chars.slice(i, i + needle.length).join(''), hit: true });
      i += needle.length;
      from = i;
    } else i++;
  }
  if (from < chars.length) parts.push({ text: chars.slice(from).join(''), hit: false });
  return parts;
}
