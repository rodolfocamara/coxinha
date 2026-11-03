import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { dayKey } from '../sessions/sessionDates';
import type { MeetingRow } from './meetingRows';
import { clockTime } from './format';
import { CalendarBlock, blockTime, px } from './CalendarBlock';
import { HOUR_PX, allDayKeys, initialScroll, isAllDay, layoutDay } from './weekLayout';
import { atMinutes, type Range } from './gridSelect';
import { useGridCreate } from './useGridCreate';
import './weekView.css';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * Outlook's time grid for any list of days (spec 0104): day columns on an
 * hour axis, every meeting a block as tall as it lasts and a native button
 * that opens the meeting in the list view. An empty slot proposes a new
 * meeting (P5) when `onCreate` is given.
 */
export function TimeGridView({
  days,
  rows,
  now,
  isLive,
  onSelect,
  onCreate,
}: {
  days: Date[];
  rows: MeetingRow[];
  now: Date;
  isLive: (row: MeetingRow) => boolean;
  onSelect: (row: MeetingRow) => void;
  onCreate?: (start: Date, end: Date) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const today = dayKey(now);
  const scroller = useRef<HTMLDivElement>(null);
  const allDay = rows.filter(isAllDay);
  const columns = { '--mh-week-days': days.length } as CSSProperties;
  const create = useGridCreate(onCreate);

  const rangeKey = days.map(dayKey).join();
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = initialScroll(days, now);
    // Only a new range re-positions the axis; the minute tick must not.
  }, [rangeKey]);

  return (
    <div className="mh-week-grid cx-glass" ref={scroller} style={columns}>
      <div className="mh-week-top">
        <div className="mh-week-head" aria-hidden="true">
          <span />
          {days.map((day) => (
            <span
              key={dayKey(day)}
              className="mh-week-day"
              data-today={dayKey(day) === today || undefined}
            >
              <b>{day.getDate()}</b>
              {day.toLocaleDateString(locale, { weekday: 'short' })}
            </span>
          ))}
        </div>
        <div className="mh-week-allday">
          <span className="mh-week-gutter">{t('meetingsHub.calendar.allDay')}</span>
          {days.map((day) => {
            const key = dayKey(day);
            return (
              <div key={key} className="mh-week-allday-cell">
                {allDay
                  .filter((row) => allDayKeys(row).includes(key))
                  .map((row) => (
                    <CalendarBlock
                      key={row.key}
                      row={row}
                      live={false}
                      onSelect={onSelect}
                      when={day.toLocaleDateString(locale, { weekday: 'long', day: 'numeric' })}
                    />
                  ))}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mh-week-body" style={{ height: 24 * HOUR_PX }}>
        <div className="mh-week-hours" aria-hidden="true">
          {HOURS.map((hour) => (
            <span key={hour} style={{ top: hour * HOUR_PX }}>
              {hour === 0 ? '' : clockTime(new Date(2000, 0, 1, hour), locale)}
            </span>
          ))}
        </div>
        {days.map((day) => (
          <section
            key={dayKey(day)}
            className="mh-week-col"
            aria-label={day.toLocaleDateString(locale, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
            aria-current={dayKey(day) === today ? 'date' : undefined}
            data-creating={create.selecting || undefined}
            {...create.columnProps(day)}
          >
            {layoutDay(rows, day, now, isLive).map((block) => (
              <CalendarBlock
                key={block.row.key}
                row={block.row}
                block={block}
                live={isLive(block.row)}
                onSelect={onSelect}
                when={blockTime(block, day, locale)}
              />
            ))}
            <Draft range={create.preview(day)} day={day} locale={locale} />
            {dayKey(day) === today && (
              <i
                className="mh-week-now"
                aria-hidden="true"
                style={{ top: px((now.getTime() - day.getTime()) / 60_000) }}
              />
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

/** The slot being dragged, before the sheet opens. */
function Draft({ range, day, locale }: { range: Range | null; day: Date; locale: string }) {
  if (!range) return null;
  const at = (minutes: number) => clockTime(atMinutes(day, minutes), locale);
  return (
    <div
      className="mh-week-draft"
      aria-hidden="true"
      style={{ top: px(range.from), height: px(range.to - range.from) }}
    >
      {at(range.from)}–{at(range.to)}
    </div>
  );
}
