import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { rem } from '../../lib/appearance/units';
import { dayKey } from '../sessions/sessionDates';
import type { MeetingRow } from './meetingRows';
import { clockTime } from './format';
import { CalendarBlock, blockTime, px, type GridActions } from './CalendarBlock';
import { HOUR_PX, allDayKeys, initialScroll, isAllDay, layoutDay } from './weekLayout';
import { atMinutes, type Range } from './gridSelect';
import { useGridCreate } from './useGridCreate';
import { TimeGutter, ZoneHeadings, gutterStyle, useExtraZones } from './TimeGutter';
import './weekView.css';

/**
 * Outlook's time grid for any list of days (spec 0104): day columns on an
 * hour axis, every meeting a block as tall as it lasts and a native button. An empty slot proposes a new
 * meeting (P5) when `onCreate` is given.
 */
export function TimeGridView({
  days,
  rows,
  now,
  isLive,
  onCreate,
  ...actions
}: GridActions & {
  days: Date[];
  rows: MeetingRow[];
  now: Date;
  isLive: (row: MeetingRow) => boolean;
  onCreate?: (start: Date, end: Date) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const today = dayKey(now);
  const scroller = useRef<HTMLDivElement>(null);
  const allDay = rows.filter(isAllDay);
  const zones = useExtraZones();
  const columns = { '--mh-week-days': days.length, ...gutterStyle(zones.length) } as CSSProperties;
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
          <ZoneHeadings zones={zones} day={days[0]} locale={locale} />
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
                      now={now}
                      {...actions}
                      when={day.toLocaleDateString(locale, { weekday: 'long', day: 'numeric' })}
                    />
                  ))}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mh-week-body" style={{ height: rem(24 * HOUR_PX) }}>
        <TimeGutter zones={zones} day={days[0]} locale={locale} />
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
                now={now}
                {...actions}
                when={blockTime(block, day, locale)}
              />
            ))}
            <Draft range={create.preview(day)} day={day} locale={locale} />
            {dayKey(day) === today && (
              <i
                className="mh-week-now"
                aria-hidden="true"
                style={{ top: rem(px((now.getTime() - day.getTime()) / 60_000)) }}
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
      style={{ top: rem(px(range.from)), height: rem(px(range.to - range.from)) }}
    >
      {at(range.from)}–{at(range.to)}
    </div>
  );
}
