import { dayKey, localDay, nextDay, parseCivilDate } from '../sessions/sessionDates';
import type { MeetingRow } from './meetingRows';

export const HOUR_PX = 48;
const DAY_MIN = 24 * 60;
const MIN_MINUTES = 15;
const OPEN_MINUTES = 30;

/** Monday of the week holding `date`, `offset` weeks away. */
export function weekStart(date: Date, offset = 0): Date {
  const day = localDay(date.getFullYear(), date.getMonth(), date.getDate());
  return nextDay(day, offset * 7 - ((day.getDay() + 6) % 7));
}

export function weekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => nextDay(start, i));
}

export const isAllDay = (row: MeetingRow) =>
  row.kind === 'event' ? row.event.allDay : (row.kind === 'session' && row.event?.allDay) || false;

/** Civil days an all-day event covers; its end date is exclusive. */
export function allDayKeys(row: MeetingRow): string[] {
  const event = row.kind === 'recording' ? null : row.event;
  if (!event) return [];
  const first = parseCivilDate(event.startsAt.slice(0, 10));
  if (!first) return [];
  const end = parseCivilDate(event.endsAt.slice(0, 10));
  const keys = [dayKey(first)];
  for (let day = nextDay(first); end && day < end && keys.length < 366; day = nextDay(day))
    keys.push(dayKey(day));
  return keys;
}

export type Block = {
  row: MeetingRow;
  /** Minutes from the day's midnight. */
  top: number;
  bottom: number;
  lane: number;
  lanes: number;
};

/** When the row ends: its end, now while live, else a 30-minute default. */
function endOf(row: MeetingRow, live: boolean, now: Date): Date {
  if (row.end && row.end > row.start!) return row.end;
  if (live && now > row.start!) return now;
  return new Date(row.start!.getTime() + OPEN_MINUTES * 60_000);
}

/**
 * Timed rows of one day, clipped at midnight, packed into lanes: overlapping
 * blocks form a cluster, each takes the first free lane, and every block of
 * the cluster shares its width.
 */
export function layoutDay(
  rows: MeetingRow[],
  day: Date,
  now: Date,
  isLive: (row: MeetingRow) => boolean
): Block[] {
  const start = day.getTime();
  const end = nextDay(day).getTime();
  const blocks = rows
    .filter((row) => row.start && !isAllDay(row))
    .map((row) => ({ row, from: row.start!.getTime(), to: endOf(row, isLive(row), now).getTime() }))
    .filter(({ from, to }) => from < end && to > start)
    .map(({ row, from, to }) => {
      let top = Math.max(0, (from - start) / 60_000);
      let bottom = Math.min(DAY_MIN, (to - start) / 60_000);
      if (bottom - top < MIN_MINUTES) {
        bottom = Math.min(DAY_MIN, top + MIN_MINUTES);
        top = bottom - MIN_MINUTES;
      }
      return { row, top, bottom };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom || a.row.key.localeCompare(b.row.key));

  const placed: Block[] = [];
  let cluster: Block[] = [];
  let clusterEnd = -1;
  const close = () => {
    const lanes = Math.max(0, ...cluster.map((b) => b.lane)) + 1;
    for (const block of cluster) block.lanes = lanes;
    cluster = [];
  };
  for (const { row, top, bottom } of blocks) {
    if (top >= clusterEnd) close();
    const busy = new Set(cluster.filter((b) => b.bottom > top).map((b) => b.lane));
    let lane = 0;
    while (busy.has(lane)) lane++;
    const block = { row, top, bottom, lane, lanes: 1 };
    cluster.push(block);
    placed.push(block);
    clusterEnd = Math.max(clusterEnd, bottom);
  }
  close();
  return placed;
}

/**
 * Where the hour axis opens: an hour before now this week, else 07:00, with
 * room for that hour's label under the sticky header.
 */
export function initialScroll(days: Date[], now: Date): number {
  const thisWeek = days.some((day) => dayKey(day) === dayKey(now));
  const hour = thisWeek ? Math.max(0, now.getHours() - 1) : 7;
  return Math.max(0, hour * HOUR_PX - 10);
}
