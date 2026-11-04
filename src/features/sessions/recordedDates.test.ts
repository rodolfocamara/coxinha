import { expect, it } from 'vitest';
import { calendarSession } from './calendarFixtures';
import { sessionDate } from './sessionDates';
it('F1 reviewer counterexample: real SQLite CURRENT_TIMESTAMP must be a UTC recorded instant', () => {
  const row = calendarSession('r', {
    origin: 'recording',
    meeting_id: 'm',
    recording: { id: 'm', title: 'r', createdAt: '2026-10-25 15:00:00', captureState: 'finished' },
  });
  expect(sessionDate(row)?.date.toISOString()).toBe('2026-10-25T15:00:00.000Z');
  expect(sessionDate(row)?.source).toBe('recorded');
});

import fixture from './__fixtures__/sqlite-recordings.json';
import { dayKey, inPeriod } from './sessionDates';
const recording = (createdAt: string) =>
  calendarSession('r', {
    recording: { id: 'm', title: 'Synthetic', createdAt, captureState: 'finished' },
  });
it('replays timestamps from the actual meeting schema with explicit UTC equivalence', () => {
  expect(fixture.default_sample).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  for (const row of fixture.cases) {
    expect(sessionDate(recording(row.createdAt))?.date.getTime()).toBe(new Date(row.utc).getTime());
  }
});
it.runIf(process.env.TZ === 'America/Sao_Paulo')(
  'groups actual SQLite UTC timestamp on the preceding Sao Paulo civil day',
  () => {
    const row = recording(fixture.cases[0].createdAt);
    expect(sessionDate(row)?.date.getHours()).toBe(22);
    expect(dayKey(sessionDate(row)!.date)).toBe('2026-10-24');
    expect(inPeriod(row, { kind: 'custom', start: '2026-10-24', end: '2026-10-24' })).toBe(true);
    expect(inPeriod(row, { kind: 'custom', start: '2026-10-25', end: '2026-10-25' })).toBe(false);
  }
);
it.each([
  '2026-02-29 12:00:00',
  '2026-04-31 12:00:00',
  '2026-10-25 24:00:00',
  '2026-10-25 23:60:00',
  '2026-10-25 23:59:60',
  '2026-10-25',
  '2026-10-25 12:00',
  '2026-10-25 12:00:00.000',
  ' 2026-10-25 12:00:00',
])('rejects impossible/ambiguous recording timestamp %s', (value) =>
  expect(sessionDate(recording(value))).toBeNull()
);
it.each([
  '2026-10-25 07:55:00',
  '2026-10-25',
  '2026-10-25T07:55:00',
  '2026-10-25T24:00:00Z',
  '2026-10-25T23:60:00Z',
  '2026-02-30T15:00:00Z',
  '2026-10-25T15:00:00+24:00',
])('does not broaden scheduled timestamp contract for %s', (starts_at) =>
  expect(sessionDate(calendarSession('manual', { starts_at }))).toBeNull()
);
it('preserves explicit offsets and the scheduled date priority', () => {
  const row = { ...recording('2026-10-25 07:55:00'), starts_at: '2026-10-24T23:55:00-03:00' };
  expect(sessionDate(row)?.date.toISOString()).toBe('2026-10-25T02:55:00.000Z');
  expect(sessionDate(row)?.source).toBe('scheduled');
});
