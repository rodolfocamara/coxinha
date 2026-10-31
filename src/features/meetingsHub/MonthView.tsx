import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../components/ui';
import { dayKey, monthStart, monthWeeks } from '../sessions/sessionDates';
import { rowsByDay, type MeetingRow } from './meetingRows';
import { clockTime } from './format';

/**
 * "Mês" tab: a month grid of meetings and Outlook events. Every item is a
 * native button that opens the meeting in the list view.
 */
export function MonthView({
  rows,
  now,
  isLive,
  onSelect,
}: {
  rows: MeetingRow[];
  now: Date;
  isLive: (row: MeetingRow) => boolean;
  onSelect: (row: MeetingRow) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.month.${key}`, options);
  const [month, setMonth] = useState(() => monthStart(now));
  const weeks = monthWeeks(month);
  const days = rowsByDay(rows);
  const today = dayKey(now);
  const raw = month.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const label = raw.charAt(0).toLocaleUpperCase(locale) + raw.slice(1);
  return (
    <section className="mh-month" id="meetings-list-panel-month-grid" aria-label={label}>
      <div className="mh-month-head">
        <Button
          size="sm"
          iconOnly
          icon={<ChevronLeft size={15} aria-hidden="true" />}
          aria-label={k('previous')}
          onClick={() => setMonth(monthStart(month, -1))}
        />
        <Button size="sm" onClick={() => setMonth(monthStart(now))}>
          {k('today')}
        </Button>
        <Button
          size="sm"
          iconOnly
          icon={<ChevronRight size={15} aria-hidden="true" />}
          aria-label={k('next')}
          onClick={() => setMonth(monthStart(month, 1))}
        />
        <h2 className="mh-month-title" aria-live="polite">
          {label}
        </h2>
        <span className="flex-1" />
        <span className="mh-legend">
          <span>
            <i className="mh-dot" data-tone="info" aria-hidden="true" /> {k('outlook')}
          </span>
          <span>
            <i className="mh-dot" aria-hidden="true" /> {k('meeting')}
          </span>
        </span>
      </div>
      <table className="mh-month-grid cx-glass">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {weeks[0].map((date) => (
              <th key={date.getDay()} scope="col">
                <abbr
                  className="no-underline"
                  title={date.toLocaleDateString(locale, { weekday: 'long' })}
                >
                  {date.toLocaleDateString(locale, { weekday: 'short' })}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={dayKey(week[0])}>
              {week.map((date) => {
                const key = dayKey(date);
                const outside = date.getMonth() !== month.getMonth();
                const items = outside ? [] : (days.get(key) ?? []);
                return (
                  <td
                    key={key}
                    data-outside={outside || undefined}
                    aria-current={key === today ? 'date' : undefined}
                  >
                    <span className="mh-day-n">{date.getDate()}</span>
                    {items.map((row) => (
                      <button
                        key={row.key}
                        type="button"
                        className="mh-month-ev"
                        onClick={() => onSelect(row)}
                        title={`${clockTime(row.start!, locale)} ${row.title}`}
                      >
                        <i
                          className="mh-dot"
                          aria-hidden="true"
                          data-tone={
                            isLive(row) ? 'live' : row.kind === 'event' ? 'info' : undefined
                          }
                        />
                        <span className="sr-only">{clockTime(row.start!, locale)} </span>
                        <span className="truncate">{row.title || t('meetingsHub.untitled')}</span>
                      </button>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
