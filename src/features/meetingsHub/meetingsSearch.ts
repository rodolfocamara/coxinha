import { dayCount, isCalendarView, type CalendarView } from './calendarViews';

export type DetailPanel = 'notes' | 'transcript' | 'people' | 'files';
const PANELS: DetailPanel[] = ['notes', 'transcript', 'people', 'files'];

export type MeetingsSearch = {
  /** Spec 0104 P4: calendar view and day count; absent means the remembered one. */
  view?: CalendarView;
  days?: number;
  /** Spec 0107: opens the "A revisar" sheet over the calendar. */
  review?: true;
  /** Full meeting page of an Outlook event or a loose recording. */
  event?: string;
  recording?: string;
  /** Tab the full meeting page opens on. */
  panel?: DetailPanel;
  /** Spec 0122: text the transcript opens found at. */
  find?: string;
};

/** Search params of `/meetings` and `/meetings/$sessionId`; unknown values are dropped. */
export function validateMeetingsSearch(search: Record<string, unknown>): MeetingsSearch {
  const out: MeetingsSearch = {};
  // The old list tabs: review became a sheet, the week and month tabs views.
  if (search.tab === 'review' || search.review === true || search.review === 'true')
    out.review = true;
  if (search.tab === 'week' || search.tab === 'month') out.view = search.tab;
  if (isCalendarView(search.view)) out.view = search.view;
  const days = dayCount(search.days);
  if (days) out.days = days;
  if (typeof search.event === 'string' && search.event) out.event = search.event;
  if (typeof search.recording === 'string' && search.recording) out.recording = search.recording;
  if (PANELS.includes(search.panel as DetailPanel)) out.panel = search.panel as DetailPanel;
  if (typeof search.find === 'string' && search.find.trim()) out.find = search.find;
  return out;
}
