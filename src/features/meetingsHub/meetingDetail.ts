import type { MeetingRow } from './meetingRows';
import type { AttendeeGroupId } from './eventDetails';

/** Spec 0126: the panel reads differently before and after a meeting. */
export type PanelState = 'upcoming' | 'now' | 'past';

export function panelState(row: MeetingRow, now: Date, hasRecording: boolean): PanelState {
  const ended = !!row.end && row.end <= now;
  const started = !!row.start && row.start <= now;
  if (ended || (!row.end && started && hasRecording)) return 'past';
  return started && row.end ? 'now' : 'upcoming';
}

const MINUTE = 60_000;
const DAY = 86_400_000;
const midnight = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** "in 25 minutes", "2 hours ago", "tomorrow", "in 3 weeks". */
export function relativeLabel(date: Date, now: Date, locale: string) {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const days = Math.round((midnight(date) - midnight(now)) / DAY);
  if (days !== 0)
    return Math.abs(days) < 14
      ? format.format(days, 'day')
      : format.format(Math.round(days / 7), 'week');
  const minutes = Math.round((date.getTime() - now.getTime()) / MINUTE);
  return Math.abs(minutes) < 60
    ? format.format(minutes, 'minute')
    : format.format(Math.sign(minutes) * Math.round(Math.abs(minutes) / 60), 'hour');
}

export const OPEN_WHEN_AT_MOST = 8;

/** Short lists are read whole; of a long one, only who is coming is worth opening. */
export function groupStartsOpen(
  group: AttendeeGroupId,
  size: number,
  total: number,
  past: boolean
) {
  if (total <= OPEN_WHEN_AT_MOST) return true;
  return !past && group === 'accepted' && size <= OPEN_WHEN_AT_MOST;
}
