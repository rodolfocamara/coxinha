import { describe, expect, it } from 'vitest';
import { dayKey } from '../sessions/sessionDates';
import type { MeetingRow } from './meetingRows';
import { event as calendarEvent, recording } from './meetingsHub.fixtures';
import { allDayKeys, initialScroll, layoutDay, weekDays, weekStart } from './weekLayout';

const day = new Date(2026, 10, 4); // Wednesday
const at = (h: number, m = 0, d = 4) => new Date(2026, 10, d, h, m);
const eventRow = (key: string, start: Date, end: Date): MeetingRow => ({
  kind: 'event',
  key,
  title: key,
  start,
  end,
  event: calendarEvent({
    id: key,
    title: key,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
  }),
});
const allDay = (key: string, startsAt: string, endsAt: string): MeetingRow => ({
  kind: 'event',
  key,
  title: key,
  start: new Date(startsAt),
  end: new Date(endsAt),
  event: calendarEvent({ id: key, title: key, startsAt, endsAt, allDay: true }),
});
const notLive = () => false;
const lanes = (rows: MeetingRow[], now = at(8)) =>
  Object.fromEntries(
    layoutDay(rows, day, now, notLive).map((b) => [b.row.key, [b.lane, b.lanes, b.top, b.bottom]])
  );

describe('weekStart', () => {
  it('starts on Monday, also from a Sunday, and moves by weeks', () => {
    expect(dayKey(weekStart(day))).toBe('2026-11-02');
    expect(dayKey(weekStart(new Date(2026, 10, 8, 23)))).toBe('2026-11-02');
    expect(dayKey(weekStart(day, -1))).toBe('2026-10-26');
    expect(weekDays(weekStart(day)).map(dayKey)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
  });
});

describe('layoutDay', () => {
  it('places blocks by minutes and packs overlaps into shared lanes', () => {
    expect(
      lanes([
        eventRow('lunch', at(12), at(13, 30)),
        eventRow('focus', at(13), at(15)),
        eventRow('atlas', at(13), at(15, 20)),
        eventRow('late', at(16), at(17)),
      ])
    ).toEqual({
      lunch: [0, 3, 720, 810],
      atlas: [1, 3, 780, 920],
      focus: [2, 3, 780, 900],
      late: [0, 1, 960, 1020],
    });
  });

  it('reuses a lane freed inside the same cluster', () => {
    expect(
      lanes([
        eventRow('long', at(9), at(12)),
        eventRow('a', at(9), at(10)),
        eventRow('b', at(10), at(11)),
      ])
    ).toEqual({ long: [0, 2, 540, 720], a: [1, 2, 540, 600], b: [1, 2, 600, 660] });
  });

  it('clips at midnight and keeps a 15-minute minimum', () => {
    expect(
      lanes([
        eventRow('overnight', at(22, 0, 3), at(1, 0, 4)),
        eventRow('blip', at(10), at(10, 5)),
        eventRow('lastMinute', at(23, 55), at(23, 59)),
      ])
    ).toEqual({
      overnight: [0, 1, 0, 60],
      blip: [0, 1, 600, 615],
      lastMinute: [0, 1, 1425, 1440],
    });
  });

  it('gives rows without an end 30 minutes, or until now while live', () => {
    const loose: MeetingRow = {
      kind: 'recording',
      key: 'r',
      title: 'Recording',
      start: at(9),
      end: null,
      recording: recording('r', 'Recording'),
    };
    expect(lanes([loose])).toEqual({ r: [0, 1, 540, 570] });
    const blocks = layoutDay([loose], day, at(10, 15), () => true);
    expect(blocks[0].bottom).toBe(615);
  });

  it('leaves all-day events and other days out', () => {
    expect(
      lanes([
        allDay('holiday', '2026-11-04T00:00:00Z', '2026-11-05T00:00:00Z'),
        eventRow('tomorrow', at(9, 0, 5), at(10, 0, 5)),
      ])
    ).toEqual({});
  });
});

describe('allDayKeys', () => {
  it('uses the civil dates, end exclusive, without shifting midnight UTC', () => {
    expect(allDayKeys(allDay('h', '2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z'))).toEqual([
      '2026-11-02',
    ]);
    expect(allDayKeys(allDay('trip', '2026-11-04T00:00:00Z', '2026-11-07T00:00:00Z'))).toEqual([
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ]);
  });
});

describe('initialScroll', () => {
  it('opens an hour before now in this week, else at 07:00', () => {
    const days = weekDays(weekStart(day));
    expect(initialScroll(days, at(9, 30))).toBe(8 * 48 - 10);
    expect(initialScroll(weekDays(weekStart(day, 1)), at(9, 30))).toBe(7 * 48 - 10);
    expect(initialScroll(days, at(0, 20))).toBe(0);
  });
});
