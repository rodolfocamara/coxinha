import type { TFunction } from 'i18next';
import { dayKey } from '../sessions/sessionDates';

/** Short local clock time, "10:00". */
export function clockTime(value: Date, locale: string) {
  return value.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** Right-hand time of a list row: "10:00" today, "ter. 16:00" on another day. */
export function rowTime(start: Date | null, now: Date, locale: string) {
  if (!start) return '';
  if (dayKey(start) === dayKey(now)) return clockTime(start, locale);
  const near = Math.abs(start.getTime() - now.getTime()) < 6 * 86_400_000;
  const day = near
    ? start.toLocaleDateString(locale, { weekday: 'short' })
    : start.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return `${day} ${clockTime(start, locale)}`;
}

/** "hoje · 10:00–10:45" or "ter., 28 de out. · 16:00–16:32". */
export function whenLabel(
  start: Date | null,
  end: Date | null,
  now: Date,
  locale: string,
  t: TFunction
) {
  if (!start) return t('meetingsHub.undated');
  const day =
    dayKey(start) === dayKey(now)
      ? t('meetingsHub.today')
      : start.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const range =
    end && dayKey(end) === dayKey(start)
      ? `${clockTime(start, locale)}–${clockTime(end, locale)}`
      : clockTime(start, locale);
  return `${day} · ${range}`;
}

/** "32 min", "1 h 05". */
export function durationLabel(ms: number, t: TFunction) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return t('meetingsHub.minutes', { count: minutes });
  return t('meetingsHub.hours', {
    hours: Math.floor(minutes / 60),
    minutes: String(minutes % 60).padStart(2, '0'),
  });
}

/** Media clock, "32:10" or "1:02:03". */
export function mediaClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** "em 3h20" / "em 25 min"; null once it started. */
export function untilLabel(start: Date | null, now: Date, t: TFunction) {
  if (!start) return null;
  const minutes = Math.round((start.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return null;
  if (minutes < 60) return t('meetingsHub.inMinutes', { count: minutes });
  return t('meetingsHub.inHours', {
    hours: Math.floor(minutes / 60),
    minutes: String(minutes % 60).padStart(2, '0'),
  });
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Person hue 1..4, stable per name. */
export function hueFor(name: string) {
  let hash = 0;
  for (const char of normalizeName(name)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return (Math.abs(hash) % 4) + 1;
}
const normalizeName = (name: string) => name.trim().toLowerCase();
