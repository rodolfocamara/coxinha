import { remScale } from '../../lib/appearance/units';
import { HOUR_PX } from './weekLayout';

const LAST_MINUTE = 24 * 60 - 1;
/** A press that moves less than this is a click, not a drag. */
export const DRAG_PX = 4;

export type Range = { from: number; to: number };

/** Minutes from midnight at a vertical offset inside a day column. */
export function minutesAt(offsetY: number) {
  return Math.min(Math.max((offsetY / (HOUR_PX * remScale())) * 60, 0), LAST_MINUTE);
}

/**
 * The slot a press proposes (spec 0104 P5): a click snaps to the half hour
 * for 30 minutes; a drag snaps both ends to 15 minutes, at least 15 long.
 * Nothing runs past 23:59, so the meeting stays on its day.
 */
export function selection(pressed: number, current: number, dragged: boolean): Range {
  if (!dragged) {
    const from = Math.min(Math.floor(pressed / 30) * 30, LAST_MINUTE - 29);
    return { from, to: Math.min(from + 30, LAST_MINUTE) };
  }
  const low = Math.min(pressed, current);
  const high = Math.max(pressed, current);
  let from = Math.floor(low / 15) * 15;
  let to = Math.ceil(high / 15) * 15;
  if (to - from < 15) to = from + 15;
  if (to > LAST_MINUTE) {
    to = LAST_MINUTE;
    from = Math.min(from, to - 14);
  }
  return { from, to };
}

/** The local instant `minutes` after the day's midnight. */
export function atMinutes(day: Date, minutes: number) {
  const at = new Date(day);
  at.setHours(0, minutes, 0, 0);
  return at;
}
