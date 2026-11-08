import { dayKey, nextDay } from '../sessions/sessionDates';

export function formatTime(date: Date, locale?: string) {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
}

/** "Sexta-feira, 31 de outubro" with a capital first letter. */
export function formatLongDate(date: Date, locale?: string) {
  const text = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/** "seg", "ter"... without the trailing dot some locales add. */
export function formatWeekday(date: Date, locale?: string) {
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date).replace(/\.$/, '');
}

export type RelativeDay =
  | { kind: 'today'; time: string }
  | { kind: 'yesterday' }
  | { kind: 'date'; text: string };

/** How recent a note edit is: today with time, yesterday, a weekday this week, or a date. */
export function relativeDay(value: string, now: Date, locale?: string): RelativeDay | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const key = dayKey(date);
  if (key === dayKey(now)) return { kind: 'today', time: formatTime(date, locale) };
  if (key === dayKey(nextDay(now, -1))) return { kind: 'yesterday' };
  const sixDaysAgo = nextDay(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -6);
  if (date >= sixDaysAgo) return { kind: 'date', text: formatWeekday(date, locale) };
  return {
    kind: 'date',
    text: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date),
  };
}
