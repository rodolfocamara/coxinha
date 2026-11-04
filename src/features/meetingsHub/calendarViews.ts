import { localDay, monthStart, nextDay } from '../sessions/sessionDates';
import { weekDays, weekStart } from './weekLayout';

/** Spec 0104 P4: Outlook's calendar switcher. */
export type CalendarView = 'day' | 'workweek' | 'week' | 'month';
export const CALENDAR_VIEWS: CalendarView[] = ['day', 'workweek', 'week', 'month'];
export const DAY_COUNTS = [1, 2, 3, 4, 5, 6, 7] as const;
export type CalendarPrefs = { view: CalendarView; days: number };

const VIEW_KEY = 'coxinha:calendar-view';
const DAYS_KEY = 'coxinha:calendar-days';
export const CALENDAR_PREF_KEYS = [VIEW_KEY, DAYS_KEY];
const DEFAULT_PREFS: CalendarPrefs = { view: 'week', days: 1 };

export const isCalendarView = (value: unknown): value is CalendarView =>
  CALENDAR_VIEWS.includes(value as CalendarView);

/** 1–7, else null. */
export function dayCount(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 7 ? n : null;
}

export function readCalendarPrefs(): CalendarPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  const view = window.localStorage.getItem(VIEW_KEY);
  return {
    view: isCalendarView(view) ? view : DEFAULT_PREFS.view,
    days: dayCount(window.localStorage.getItem(DAYS_KEY)) ?? DEFAULT_PREFS.days,
  };
}

export function writeCalendarPrefs(prefs: CalendarPrefs) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(VIEW_KEY, prefs.view);
  window.localStorage.setItem(DAYS_KEY, String(prefs.days));
}

const startOfDay = (date: Date) => localDay(date.getFullYear(), date.getMonth(), date.getDate());

/** The columns of a time-grid view; the month grid picks its own weeks. */
export function visibleDays(view: CalendarView, anchor: Date, days: number): Date[] {
  if (view === 'day') return Array.from({ length: days }, (_, i) => nextDay(startOfDay(anchor), i));
  const week = weekDays(weekStart(anchor));
  return view === 'workweek' ? week.slice(0, 5) : week;
}

/** First and last civil day in view, both inclusive. */
export function viewRange(view: CalendarView, anchor: Date, days: number) {
  if (view === 'month') {
    const first = monthStart(anchor);
    return { first, last: nextDay(monthStart(anchor, 1), -1) };
  }
  const shown = visibleDays(view, anchor, days);
  return { first: shown[0], last: shown[shown.length - 1] };
}

/** Previous or next: the days shown for the day view, a week, or a month. */
export function stepAnchor(
  view: CalendarView,
  anchor: Date,
  days: number,
  direction: 1 | -1
): Date {
  if (view === 'month') return monthStart(anchor, direction);
  return nextDay(startOfDay(anchor), direction * (view === 'day' ? days : 7));
}
