import { dayKey, monthStart } from '../sessions/sessionDates';
import type { MeetingRow } from './meetingRows';
import { visibleDays, type CalendarView } from './calendarViews';
import { MonthGrid } from './MonthGrid';
import { TimeGridView } from './TimeGridView';
import type { GridActions } from './CalendarBlock';
import './monthView.css';
import './calendarPage.css';

export type { GridActions } from './CalendarBlock';

/**
 * Outlook's day, work week, week and month grids (spec 0104 P4); the toolbar
 * and paging live in the calendar home (spec 0107).
 */
export function CalendarGrid({
  view,
  days,
  anchor,
  rows,
  now,
  isLive,
  onCreate,
  ...actions
}: GridActions & {
  view: CalendarView;
  days: number;
  anchor: Date;
  rows: MeetingRow[];
  now: Date;
  isLive: (row: MeetingRow) => boolean;
  onCreate?: (start: Date, end: Date) => void;
}) {
  if (view === 'month')
    return (
      <MonthGrid month={monthStart(anchor)} rows={rows} now={now} isLive={isLive} {...actions} />
    );
  return (
    <TimeGridView
      days={visibleDays(view, anchor, days)}
      rows={rows}
      now={now}
      isLive={isLive}
      onCreate={onCreate}
      {...actions}
    />
  );
}

/** "terça-feira, 3 de novembro de 2026", "3 – 9 de novembro de 2026" or "Novembro de 2026". */
export function rangeLabel(view: CalendarView, first: Date, last: Date, locale: string) {
  if (view === 'month') {
    const raw = first.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
    return raw.charAt(0).toLocaleUpperCase(locale) + raw.slice(1);
  }
  const format = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(dayKey(first) === dayKey(last) ? { weekday: 'long' } : {}),
  });
  return dayKey(first) === dayKey(last) ? format.format(first) : format.formatRange(first, last);
}
