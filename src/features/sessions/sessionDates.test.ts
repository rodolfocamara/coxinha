import { describe, expect, it } from 'vitest';
import { calendarSession } from './calendarFixtures';
import {
  customRange,
  dayKey,
  groupSessions,
  inPeriod,
  localDay,
  monthStart,
  monthWeeks,
  nextDay,
  parseCivilDate,
  periodRange,
  sessionDate,
} from './sessionDates';
import { matchesTranscript, transcriptStatus } from './transcriptStatus';

describe('local civil dates', () => {
  it.each([
    '2026-02-29',
    '2024-02-30',
    '2026-04-31',
    '0000-01-01',
    '2026-13-01',
    '2026-00-01',
    '2026-01-00',
    '26-01-01',
    '2026-1-1',
    '2026-01-01T00:00:00Z',
  ])('rejects impossible or non-civil date %s', (value) =>
    expect(parseCivilDate(value)).toBeNull()
  );
  it.each(['2024-02-29', '2000-02-29', '0001-01-01', '0099-12-31', '9999-12-31'])(
    'round-trips %s without treating years below 100 as 1900',
    (value) => expect(dayKey(parseCivilDate(value)!)).toBe(value)
  );
  it('validates reversed and empty ranges', () => {
    expect(customRange('2026-10-26', '2026-10-25')).toBeNull();
    expect(customRange('', '')).toBeNull();
    expect(customRange('2026-02-30', '2026-03-01')).toBeNull();
  });
  it('includes the entire end day and excludes the next local midnight', () => {
    const period = { kind: 'custom' as const, start: '2026-10-24', end: '2026-10-25' };
    for (const [date, expected] of [
      [localDay(2026, 9, 24), true],
      [new Date(2026, 9, 25, 23, 59, 59, 999), true],
      [localDay(2026, 9, 26), false],
      [new Date(2026, 9, 23, 23, 59), false],
    ] as const)
      expect(inPeriod(calendarSession('s', { starts_at: date.toISOString() }), period)).toBe(
        expected
      );
  });
  it('uses local scheduled dates, recorded fallback, and honest undated manual sessions', () => {
    const scheduled = calendarSession('scheduled', { starts_at: '2026-10-25T01:30:00Z' });
    const recorded = calendarSession('recorded', {
      recording: {
        id: 'r',
        title: 'r',
        captureState: 'finished',
        createdAt: '2026-10-24T15:00:00Z',
      },
    });
    expect(sessionDate(recorded)?.source).toBe('recorded');
    expect(sessionDate(calendarSession('manual'))).toBeNull();
    expect(
      sessionDate(calendarSession('invalid', { starts_at: '2026-02-30T15:00:00Z' }))
    ).toBeNull();
    expect(sessionDate(calendarSession('date-only', { starts_at: '2026-10-25' }))).toBeNull();
    const key = dayKey(new Date(scheduled.starts_at!));
    expect(
      groupSessions([calendarSession('manual'), scheduled, recorded]).find((g) =>
        g.sessions.includes(scheduled)
      )?.key
    ).toBe(key);
    if (process.env.TZ === 'America/Sao_Paulo') expect(key).toBe('2026-10-24');
    if (process.env.TZ === 'America/New_York') expect(key).toBe('2026-10-24');
    expect(groupSessions([scheduled, calendarSession('manual')]).at(-1)?.key).toBe('undated');
    expect(sessionDate({ ...recorded, starts_at: scheduled.starts_at })?.source).toBe('scheduled');
  });
  it('uses Monday weeks and 30 inclusive local civil days across month/year boundaries', () => {
    const now = new Date(2027, 0, 3, 12);
    const week = periodRange({ kind: 'week' }, now)!;
    expect([dayKey(week.start), dayKey(week.end)]).toEqual(['2026-12-28', '2027-01-04']);
    const last30 = periodRange({ kind: 'last30' }, now)!;
    expect([dayKey(last30.start), dayKey(last30.end)]).toEqual(['2026-12-05', '2027-01-04']);
    const today = periodRange({ kind: 'today' }, now)!;
    expect([dayKey(today.start), dayKey(today.end)]).toEqual(['2027-01-03', '2027-01-04']);
    const month = periodRange({ kind: 'month' }, now)!;
    expect([dayKey(month.start), dayKey(month.end)]).toEqual(['2027-01-01', '2027-02-01']);
    expect(dayKey(monthStart(now, -1))).toBe('2026-12-01');
    const leapMonth = periodRange({ kind: 'month' }, localDay(2024, 1, 12))!;
    expect([dayKey(leapMonth.start), dayKey(leapMonth.end)]).toEqual(['2024-02-01', '2024-03-01']);
  });
  it('builds complete Monday-first weeks with every leap-day and no duplicated day', () => {
    for (const month of [localDay(2024, 1, 1), localDay(2026, 11, 1), localDay(2027, 0, 1)]) {
      const weeks = monthWeeks(month);
      expect(weeks.every((w) => w.length === 7 && w[0].getDay() === 1)).toBe(true);
      const days = weeks.flat().map(dayKey);
      expect(new Set(days).size).toBe(days.length);
      const inMonth = weeks.flat().filter((d) => d.getMonth() === month.getMonth());
      expect(inMonth.length).toBe(nextDay(monthStart(month, 1), -1).getDate());
    }
  });
  it.runIf(process.env.TZ === 'America/New_York')(
    'keeps 23h and 25h DST days as single civil days',
    () => {
      const spring = customRange('2026-03-08', '2026-03-08')!;
      const fall = customRange('2026-11-01', '2026-11-01')!;
      expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 3600000);
      expect(fall.end.getTime() - fall.start.getTime()).toBe(25 * 3600000);
      expect(dayKey(spring.end)).toBe('2026-03-09');
      expect(dayKey(fall.end)).toBe('2026-11-02');
      expect(
        inPeriod(calendarSession('last', { starts_at: '2026-03-09T03:59:59Z' }), {
          kind: 'custom',
          start: '2026-03-08',
          end: '2026-03-08',
        })
      ).toBe(true);
      expect(
        inPeriod(calendarSession('next', { starts_at: '2026-03-09T04:00:00Z' }), {
          kind: 'custom',
          start: '2026-03-08',
          end: '2026-03-08',
        })
      ).toBe(false);
    }
  );
  it.runIf(process.env.TZ === 'America/Sao_Paulo')(
    'handles historical midnight DST without a fixed 24h offset',
    () => {
      const range = customRange('2018-11-04', '2018-11-04')!;
      expect(range.start.getHours()).toBe(1);
      expect(dayKey(range.start)).toBe('2018-11-04');
      expect(dayKey(range.end)).toBe('2018-11-05');
      expect(range.end.getHours()).toBe(0);
      expect(range.end.getTime() - range.start.getTime()).toBe(23 * 3600000);
    }
  );
});
describe('saved transcript projection', () => {
  it.each(['failed', 'running', 'succeeded', null])(
    'does not infer coverage from generic job state %s or recording existence',
    (processing_state) => {
      const session = calendarSession('s', {
        processing_state,
        recording: {
          id: 'm',
          title: 'm',
          captureState: 'finished',
          createdAt: '2026-10-25T15:00:00Z',
        },
      });
      expect(transcriptStatus(session)).toBe('unknown');
      expect(matchesTranscript(session, 'available')).toBe(false);
      expect(matchesTranscript(session, 'without')).toBe(false);
    }
  );
  it.each(['available', 'none', 'empty', 'unavailable', undefined] as const)(
    'uses only explicit projection %s, independently of a later running/failed job',
    (status) => {
      const session = calendarSession('s', {
        transcript_status: status,
        processing_state: 'failed',
        processing: { phase: 'running', meetingId: 'm' },
      });
      expect(matchesTranscript(session, 'all')).toBe(true);
      expect(matchesTranscript(session, 'available')).toBe(status === 'available');
      expect(matchesTranscript(session, 'without')).toBe(status === 'none' || status === 'empty');
    }
  );
});

it('fails closed for invalid programmatic custom filters', () => {
  const row = calendarSession('s', { starts_at: '2026-10-25T12:00:00Z' });
  for (const period of [
    { kind: 'custom' as const, start: '2026-02-30', end: '2026-03-01' },
    { kind: 'custom' as const, start: '2026-10-26', end: '2026-10-25' },
    { kind: 'custom' as const },
  ])
    expect(inPeriod(row, period)).toBe(false);
  expect(inPeriod(row, { kind: 'all' })).toBe(true);
});
