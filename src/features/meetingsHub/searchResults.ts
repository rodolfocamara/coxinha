import type { SearchField, SearchHit } from '../meetings/library';
import { dayKey, localDay, monthStart, nextDay } from '../sessions/sessionDates';
import { weekStart } from './weekLayout';
import { attendeesOf, normalize, type MeetingRow } from './meetingRows';

export type Match = { field: SearchField; snippet: string };
export type Result = { row: MeetingRow; matches: Match[] };
export type Period = 'any' | '30d' | 'year';
export type ResultFilters = {
  period: Period;
  person: string | null;
  category: string | null;
  transcript: boolean;
};
export const NO_FILTERS: ResultFilters = {
  period: 'any',
  person: null,
  category: null,
  transcript: false,
};

const ORDER: SearchField[] = ['title', 'people', 'category', 'notes', 'transcript'];
const categoriesOf = (row: MeetingRow) =>
  row.kind === 'recording' ? [] : (row.event?.categories ?? []);
export const peopleOf = (row: MeetingRow) => {
  const event = row.kind === 'recording' ? null : row.event;
  return [...attendeesOf(row), ...(event?.organizer ? [event.organizer] : [])];
};

/** What the rows already loaded say: title, invitees and categories. */
function localMatches(row: MeetingRow, q: string): Match[] {
  const found: Match[] = [];
  if (normalize(row.title).includes(q)) found.push({ field: 'title', snippet: row.title });
  const people = peopleOf(row)
    .filter((p) => normalize(p.name).includes(q) || normalize(p.email ?? '').includes(q))
    .map((p) => p.name || p.email || '');
  if (people.length) found.push({ field: 'people', snippet: [...new Set(people)].join(', ') });
  const categories = categoriesOf(row).filter((c) => normalize(c).includes(q));
  if (categories.length) found.push({ field: 'category', snippet: categories.join(', ') });
  return found;
}

/**
 * Rows matching the query, with one snippet per field: the backend searched
 * notes and transcripts of sessions (`library_search`); Outlook-only events
 * and the rest are matched here.
 */
export function mergeResults(rows: MeetingRow[], query: string, hits: SearchHit[]): Result[] {
  const q = normalize(query);
  if (!q) return [];
  const bySession = new Map(hits.map((hit) => [hit.id, hit.matches]));
  const results: Result[] = [];
  for (const row of rows) {
    const remote = row.kind === 'session' ? (bySession.get(row.session.id) ?? []) : [];
    const matches = [...localMatches(row, q)];
    // The row's own title is current; the backend adds people the owner added, notes and transcript.
    for (const match of remote)
      if (match.field !== 'title' && !matches.some((m) => m.field === match.field))
        matches.push(match);
    if (matches.length)
      results.push({
        row,
        matches: matches.sort((a, b) => ORDER.indexOf(a.field) - ORDER.indexOf(b.field)),
      });
  }
  return results;
}

const DAY = 86_400_000;

export function filterResults(results: Result[], filters: ResultFilters, now: Date): Result[] {
  return results.filter(({ row, matches }) => {
    const start = row.start;
    if (filters.period === '30d' && (!start || start > now || now.getTime() - +start > 30 * DAY))
      return false;
    if (filters.period === 'year' && (!start || start.getFullYear() !== now.getFullYear()))
      return false;
    if (filters.person && !peopleOf(row).some((p) => (p.name || p.email) === filters.person))
      return false;
    if (filters.category && !categoriesOf(row).includes(filters.category)) return false;
    if (
      filters.transcript &&
      !(
        matches.some((m) => m.field === 'transcript') ||
        (row.kind === 'session' && row.session.transcript_status === 'available')
      )
    )
      return false;
    return true;
  });
}

export type GroupKey =
  | { kind: 'later' }
  | { kind: 'today' }
  | { kind: 'week' }
  | { kind: 'lastWeek' }
  | { kind: 'month'; month: Date }
  | { kind: 'undated' };
export type ResultGroup = { id: string; key: GroupKey; results: Result[] };

function groupOf(start: Date | null, now: Date): GroupKey {
  if (!start) return { kind: 'undated' };
  const today = localDay(now.getFullYear(), now.getMonth(), now.getDate());
  const thisWeek = weekStart(now);
  if (start >= nextDay(thisWeek, 7)) return { kind: 'later' };
  if (dayKey(start) === dayKey(today)) return { kind: 'today' };
  if (start >= thisWeek) return { kind: 'week' };
  if (start >= weekStart(now, -1)) return { kind: 'lastWeek' };
  return { kind: 'month', month: monthStart(start) };
}

const groupId = (key: GroupKey) =>
  key.kind === 'month' ? `month-${dayKey(key.month).slice(0, 7)}` : key.kind;

/**
 * Later meetings first, then today, this week, last week and earlier months,
 * most recent first inside each group; undated last.
 */
export function groupResults(results: Result[], now: Date): ResultGroup[] {
  const groups = new Map<string, ResultGroup>();
  for (const result of results) {
    const key = groupOf(result.row.start, now);
    const id = groupId(key);
    if (!groups.has(id)) groups.set(id, { id, key, results: [] });
    groups.get(id)!.results.push(result);
  }
  const rank = (g: ResultGroup) =>
    g.key.kind === 'later'
      ? 0
      : g.key.kind === 'today'
        ? 1
        : g.key.kind === 'week'
          ? 2
          : g.key.kind === 'lastWeek'
            ? 3
            : g.key.kind === 'month'
              ? 4
              : 5;
  const time = (r: Result) => r.row.start?.getTime() ?? 0;
  return [...groups.values()]
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.key.kind === 'month' && b.key.kind === 'month' ? +b.key.month - +a.key.month : 0)
    )
    .map((group) => ({
      ...group,
      results: group.results.sort((a, b) =>
        group.key.kind === 'later' ? time(a) - time(b) : time(b) - time(a)
      ),
    }));
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
