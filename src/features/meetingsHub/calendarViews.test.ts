import { beforeEach, describe, expect, it } from 'vitest';
import { dayKey } from '../sessions/sessionDates';
import {
  CALENDAR_PREF_KEYS,
  dayCount,
  readCalendarPrefs,
  stepAnchor,
  viewRange,
  visibleDays,
  writeCalendarPrefs,
} from './calendarViews';
import { validateMeetingsSearch } from './meetingsSearch';

// Thursday 15 October 2026, mid-afternoon.
const anchor = new Date(2026, 9, 15, 15, 30);
const keys = (days: Date[]) => days.map(dayKey);

describe('visibleDays', () => {
  it('shows N days from the anchor in the day view', () => {
    expect(keys(visibleDays('day', anchor, 1))).toEqual(['2026-10-15']);
    expect(keys(visibleDays('day', anchor, 3))).toEqual(['2026-10-15', '2026-10-16', '2026-10-17']);
  });

  it('shows Monday to Friday or Monday to Sunday for the weeks', () => {
    expect(keys(visibleDays('workweek', anchor, 3))).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
    ]);
    expect(keys(visibleDays('week', new Date(2026, 9, 18), 1))).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
  });
});

describe('viewRange and stepAnchor', () => {
  it('covers the whole month and the days shown', () => {
    const month = viewRange('month', anchor, 1);
    expect([dayKey(month.first), dayKey(month.last)]).toEqual(['2026-10-01', '2026-10-31']);
    const days = viewRange('day', anchor, 2);
    expect([dayKey(days.first), dayKey(days.last)]).toEqual(['2026-10-15', '2026-10-16']);
  });

  it('steps by the days shown, a week or a month', () => {
    expect(dayKey(stepAnchor('day', anchor, 3, 1))).toBe('2026-10-18');
    expect(dayKey(stepAnchor('day', anchor, 1, -1))).toBe('2026-10-14');
    expect(dayKey(stepAnchor('workweek', anchor, 3, 1))).toBe('2026-10-22');
    expect(dayKey(stepAnchor('week', anchor, 3, -1))).toBe('2026-10-08');
    expect(dayKey(stepAnchor('month', new Date(2026, 0, 31), 1, 1))).toBe('2026-02-01');
  });
});

describe('prefs and URLs', () => {
  beforeEach(() => {
    for (const key of CALENDAR_PREF_KEYS) window.localStorage.removeItem(key);
  });

  it('remembers the view and day count, ignoring broken values', () => {
    expect(readCalendarPrefs()).toEqual({ view: 'week', days: 1 });
    writeCalendarPrefs({ view: 'day', days: 4 });
    expect(readCalendarPrefs()).toEqual({ view: 'day', days: 4 });
    window.localStorage.setItem(CALENDAR_PREF_KEYS[0], 'year');
    window.localStorage.setItem(CALENDAR_PREF_KEYS[1], '9');
    expect(readCalendarPrefs()).toEqual({ view: 'week', days: 1 });
  });

  it('accepts 1–7 days only', () => {
    expect([dayCount(1), dayCount('7'), dayCount(0), dayCount(8), dayCount('2.5')]).toEqual([
      1,
      7,
      null,
      null,
      null,
    ]);
  });

  it('maps the old list tabs onto the calendar home (spec 0107)', () => {
    expect(validateMeetingsSearch({ tab: 'week' })).toEqual({ view: 'week' });
    expect(validateMeetingsSearch({ tab: 'month', event: 'e' })).toEqual({
      view: 'month',
      event: 'e',
    });
    expect(validateMeetingsSearch({ tab: 'calendar', view: 'day', days: '3' })).toEqual({
      view: 'day',
      days: 3,
    });
    expect(validateMeetingsSearch({ tab: 'review' })).toEqual({ review: true });
    expect(validateMeetingsSearch({ panel: 'transcript', bogus: 1 })).toEqual({
      panel: 'transcript',
    });
    expect(validateMeetingsSearch({ panel: 'nope' })).toEqual({});
  });
});
