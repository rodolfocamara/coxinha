import type { Session } from './sessions';

export type PeriodKind = 'all' | 'today' | 'week' | 'month' | 'last30' | 'custom';
export type Period = { kind: PeriodKind; start?: string; end?: string };
export type DateRange = { start: Date; end: Date };

/** Civil dates are local. Never slice a UTC timestamp or add fixed 24-hour intervals. */
export function localDay(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setFullYear(year, month, day);
  date.setHours(0, 0, 0, 0);
  return date;
}
export function dayKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function parseCivilDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = localDay(year, month - 1, day);
  return dayKey(date) === value ? date : null;
}
export function nextDay(date: Date, amount = 1): Date {
  return localDay(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}
export function customRange(start: string, end: string): DateRange | null {
  const first = parseCivilDate(start);
  const last = parseCivilDate(end);
  return first && last && first <= last ? { start: first, end: nextDay(last) } : null;
}
export function monthStart(date: Date, offset = 0): Date {
  return localDay(date.getFullYear(), date.getMonth() + offset, 1);
}
/** Week starts Monday. Inclusive end inputs become the next local midnight, even across DST. */
export function periodRange(period: Period, now = new Date()): DateRange | null {
  const today = localDay(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period.kind) {
    case 'all':
      return null;
    case 'today':
      return { start: today, end: nextDay(today) };
    case 'week': {
      const start = nextDay(today, -((today.getDay() + 6) % 7));
      return { start, end: nextDay(start, 7) };
    }
    case 'month':
      return { start: monthStart(today), end: monthStart(today, 1) };
    case 'last30':
      return { start: nextDay(today, -29), end: nextDay(today) };
    case 'custom':
      return customRange(period.start ?? '', period.end ?? '');
  }
}
function validCivilFields(year: number, month: number, day: number): boolean {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
  );
}
function instant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const fields =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/i.exec(
      value
    );
  if (!fields) return null;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = fields;
  if (
    !validCivilFields(+year, +month, +day) ||
    +hour > 23 ||
    +minute > 59 ||
    +(second ?? 0) > 59 ||
    +(offsetHour ?? 0) > 23 ||
    +(offsetMinute ?? 0) > 59
  )
    return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
/** Only this boundary accepts meeting.created_at's exact SQLite UTC schema default. */
function recordingInstant(value: string | null | undefined): Date | null {
  const normalized = value?.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/, '$1T$2Z');
  return instant(normalized);
}
export function sessionDate(
  session: Session
): { date: Date; source: 'scheduled' | 'recorded' } | null {
  const scheduled = instant(session.starts_at);
  if (scheduled) return { date: scheduled, source: 'scheduled' };
  const recorded = recordingInstant(session.recording?.createdAt);
  return recorded ? { date: recorded, source: 'recorded' } : null;
}
export function inPeriod(session: Session, period: Period, now = new Date()): boolean {
  const occurrence = sessionDate(session);
  if (!occurrence) return false;
  const range = periodRange(period, now);
  return (
    period.kind === 'all' ||
    (!!range && occurrence.date >= range.start && occurrence.date < range.end)
  );
}
export function groupSessions(
  rows: Session[]
): { key: string; date: Date | null; sessions: Session[] }[] {
  const groups = new Map<string, { key: string; date: Date | null; sessions: Session[] }>();
  const sorted = [...rows].sort(
    (a, b) =>
      (sessionDate(b)?.date.getTime() ?? -Infinity) -
        (sessionDate(a)?.date.getTime() ?? -Infinity) || a.id.localeCompare(b.id)
  );
  for (const session of sorted) {
    const date = sessionDate(session)?.date ?? null;
    const key = date ? dayKey(date) : 'undated';
    if (!groups.has(key)) groups.set(key, { key, date, sessions: [] });
    groups.get(key)!.sessions.push(session);
  }
  return [...groups.values()];
}
export function monthWeeks(month: Date): Date[][] {
  const first = monthStart(month);
  const start = nextDay(first, -((first.getDay() + 6) % 7));
  const end = monthStart(month, 1);
  const weeks: Date[][] = [];
  for (let day = start; day < end; ) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = nextDay(day);
    }
    weeks.push(week);
  }
  return weeks;
}
