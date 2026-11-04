import { useShortcut, useShortcutScope } from '../../lib/shortcuts';
import type { CalendarView } from './calendarViews';

/** Spec 0128 P5: Google Calendar's keys, on the calendar only. */
export function useCalendarKeys(actions: {
  today: () => void;
  move: (direction: 1 | -1) => void;
  view: (view: CalendarView) => void;
  create: () => void;
  canCreate: boolean;
}) {
  useShortcutScope('calendar');
  useShortcut('calendar.today', () => actions.today());
  useShortcut('calendar.next', () => actions.move(1));
  useShortcut('calendar.previous', () => actions.move(-1));
  useShortcut('calendar.day', () => actions.view('day'));
  useShortcut('calendar.week', () => actions.view('week'));
  useShortcut('calendar.month', () => actions.view('month'));
  useShortcut('calendar.new', () => actions.create(), { enabled: actions.canCreate });
}
