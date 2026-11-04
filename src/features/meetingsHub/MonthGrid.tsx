import { useTranslation } from 'react-i18next';
import { dayKey, monthWeeks } from '../sessions/sessionDates';
import { rowsByDay, type MeetingRow } from './meetingRows';
import { clockTime } from './format';
import { OUTLOOK_PRESETS, colourStyle, colourVar, useEventColour } from '../agenda/categories';
import { CategoryLabel } from '../agenda/CategoryLabel';
import { itemHandlers, type GridActions } from './CalendarBlock';
import { eventLook } from './eventDetailsModel';
import './monthView.css';

/**
 * Month grid of the calendar page (spec 0104 P4): meetings and Outlook events
 * by day. Every item is a native button.
 */
export function MonthGrid({
  month,
  rows,
  now,
  isLive,
  ...actions
}: GridActions & {
  month: Date;
  rows: MeetingRow[];
  now: Date;
  isLive: (row: MeetingRow) => boolean;
}) {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const weeks = monthWeeks(month);
  const days = rowsByDay(rows);
  const today = dayKey(now);
  const label = month.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  return (
    <div className="mh-month-body">
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
                      <MonthItem key={row.key} row={row} live={isLive(row)} {...actions} />
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MonthItem({
  row,
  live,
  ...actions
}: GridActions & {
  row: MeetingRow;
  live: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const colour = useEventColour(row.kind === 'recording' ? null : row.event);
  const tinted = colour && !live;
  const look = eventLook(row.kind === 'recording' ? null : row.event);
  return (
    <button
      type="button"
      className="mh-month-ev"
      data-key={row.key}
      data-look={look ?? undefined}
      data-category={tinted ? OUTLOOK_PRESETS[colour.preset] : undefined}
      style={tinted ? colourStyle(colour.preset) : undefined}
      {...itemHandlers(row, actions)}
      title={`${clockTime(row.start!, locale)} ${row.title}`}
    >
      <i
        className="mh-dot"
        aria-hidden="true"
        data-tone={live ? 'live' : row.kind === 'event' && !colour ? 'info' : undefined}
        data-category={tinted ? '' : undefined}
        style={tinted ? { background: colourVar(colour.preset), opacity: 1 } : undefined}
      />
      <span className="sr-only">{clockTime(row.start!, locale)} </span>
      <span className="truncate">{row.title || t('meetingsHub.untitled')}</span>
      <CategoryLabel colour={colour} />
      {look && <span className="sr-only">{t(`meetingsHub.eventDetails.look.${look}`)}</span>}
    </button>
  );
}
