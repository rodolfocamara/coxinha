import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, SearchX } from 'lucide-react';
import { Button } from '../../components/ui';
import { dayKey, monthStart, nextDay } from '../sessions/sessionDates';
import type { MeetingRow } from './meetingRows';
import { stepAnchor, viewRange, visibleDays, type CalendarView } from './calendarViews';
import { allDayKeys, isAllDay } from './weekLayout';
import { MonthGrid } from './MonthGrid';
import { TimeGridView } from './TimeGridView';
import { ViewSwitcher } from './ViewSwitcher';
import './monthView.css';
import './calendarPage.css';

/**
 * "Calendário" tab (spec 0104 P4): Outlook's day, work week, week and month
 * views on one page. `rows` arrive already filtered by the list's search.
 */
export function CalendarPage({
  view,
  days,
  rows,
  searching,
  now,
  isLive,
  onView,
  onSelect,
  onCreate,
}: {
  view: CalendarView;
  days: number;
  rows: MeetingRow[];
  searching: boolean;
  now: Date;
  isLive: (row: MeetingRow) => boolean;
  onView: (view: CalendarView, days: number) => void;
  onSelect: (row: MeetingRow) => void;
  onCreate?: (start: Date, end: Date) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.calendar.${key}`, options);
  const [anchor, setAnchor] = useState(now);
  const range = viewRange(view, anchor, days);
  const label = rangeLabel(view, range.first, range.last, locale);
  const empty = searching && !rows.some((row) => inRange(row, range.first, range.last));
  const step = view === 'day' ? 'Day' : view === 'month' ? 'Month' : 'Week';
  const stepOptions = view === 'day' ? { count: days } : undefined;

  return (
    <section className="mh-month mh-cal" aria-label={label}>
      <div className="mh-cal-bar">
        <ViewSwitcher view={view} days={days} onChange={onView} />
      </div>
      <div className="mh-month-head">
        <Button size="sm" onClick={() => setAnchor(now)}>
          {k('today')}
        </Button>
        <Button
          size="sm"
          iconOnly
          icon={<ChevronLeft size={15} aria-hidden="true" />}
          aria-label={k(`previous${step}`, stepOptions)}
          onClick={() => setAnchor(stepAnchor(view, anchor, days, -1))}
        />
        <Button
          size="sm"
          iconOnly
          icon={<ChevronRight size={15} aria-hidden="true" />}
          aria-label={k(`next${step}`, stepOptions)}
          onClick={() => setAnchor(stepAnchor(view, anchor, days, 1))}
        />
        <h2 className="mh-month-title" aria-live="polite">
          {label}
        </h2>
        <span className="flex-1" />
        {empty && (
          <span className="mh-cal-empty" role="status">
            <SearchX size={14} aria-hidden="true" />
            {k('noMatch')}
          </span>
        )}
        {view === 'month' && !empty && (
          <span className="mh-legend">
            <span>
              <i className="mh-dot" data-tone="info" aria-hidden="true" />{' '}
              {t('meetingsHub.month.outlook')}
            </span>
            <span>
              <i className="mh-dot" aria-hidden="true" /> {t('meetingsHub.month.meeting')}
            </span>
          </span>
        )}
      </div>
      {view === 'month' ? (
        <MonthGrid
          month={monthStart(anchor)}
          rows={rows}
          now={now}
          isLive={isLive}
          onSelect={onSelect}
        />
      ) : (
        <TimeGridView
          days={visibleDays(view, anchor, days)}
          rows={rows}
          now={now}
          isLive={isLive}
          onSelect={onSelect}
          onCreate={onCreate}
        />
      )}
    </section>
  );
}

/** "terça-feira, 3 de novembro de 2026", "3 – 9 de novembro de 2026" or "novembro de 2026". */
function rangeLabel(view: CalendarView, first: Date, last: Date, locale: string) {
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

function inRange(row: MeetingRow, first: Date, last: Date) {
  if (!row.start) return false;
  if (isAllDay(row)) {
    const from = dayKey(first);
    const to = dayKey(last);
    return allDayKeys(row).some((key) => key >= from && key <= to);
  }
  const end = row.end ?? row.start;
  return row.start < nextDay(last) && end >= first;
}
