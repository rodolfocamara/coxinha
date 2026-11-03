import { dayCount, isCalendarView, type CalendarView } from './calendarViews';

export type MeetingsSearch = {
  tab?: 'review' | 'calendar';
  /** Spec 0104 P4: calendar view and day count; absent means the remembered one. */
  view?: CalendarView;
  days?: number;
  event?: string;
  recording?: string;
};

/** Search params of `/meetings` and `/meetings/$sessionId`; unknown values are dropped. */
export function validateMeetingsSearch(search: Record<string, unknown>): MeetingsSearch {
  const out: MeetingsSearch = {};
  if (search.tab === 'review' || search.tab === 'calendar') out.tab = search.tab;
  // The separate week and month tabs became views of one calendar.
  if (search.tab === 'week' || search.tab === 'month') {
    out.tab = 'calendar';
    out.view = search.tab;
  }
  if (out.tab === 'calendar') {
    if (isCalendarView(search.view)) out.view = search.view;
    const days = dayCount(search.days);
    if (days) out.days = days;
  }
  if (typeof search.event === 'string' && search.event) out.event = search.event;
  if (typeof search.recording === 'string' && search.recording) out.recording = search.recording;
  return out;
}
