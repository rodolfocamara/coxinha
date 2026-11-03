import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../components/ui';
import { dayKey, nextDay } from '../sessions/sessionDates';
import type { MeetingRow } from './meetingRows';
import { clockTime } from './format';
import { OUTLOOK_PRESETS, colourStyle, useEventColour } from '../agenda/categories';
import {
  HOUR_PX,
  allDayKeys,
  initialScroll,
  isAllDay,
  layoutDay,
  weekDays,
  weekStart,
  type Block,
} from './weekLayout';
import './monthView.css';
import './weekView.css';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const px = (minutes: number) => (minutes / 60) * HOUR_PX;

/**
 * "Semana" tab (spec 0104): Outlook's week view. Seven day columns on an hour
 * axis; every meeting is a block as tall as it lasts, filled with its
 * category, and a native button that opens the meeting in the list view.
 */
export function WeekView({
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
  const k = (key: string) => t(`meetingsHub.week.${key}`);
  const [start, setStart] = useState(() => weekStart(now));
  const days = weekDays(start);
  const today = dayKey(now);
  const scroller = useRef<HTMLDivElement>(null);
  const label = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatRange(days[0], days[6]);
  const allDay = rows.filter(isAllDay);

  const weekKey = dayKey(start);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = initialScroll(weekDays(start), now);
    // Only a new week re-positions the axis; the minute tick must not.
  }, [weekKey]);

  return (
    <section className="mh-month mh-week" aria-label={label}>
      <div className="mh-month-head">
        <Button
          size="sm"
          iconOnly
          icon={<ChevronLeft size={15} aria-hidden="true" />}
          aria-label={k('previous')}
          onClick={() => setStart(weekStart(start, -1))}
        />
        <Button size="sm" onClick={() => setStart(weekStart(now))}>
          {k('today')}
        </Button>
        <Button
          size="sm"
          iconOnly
          icon={<ChevronRight size={15} aria-hidden="true" />}
          aria-label={k('next')}
          onClick={() => setStart(weekStart(start, 1))}
        />
        <h2 className="mh-month-title" aria-live="polite">
          {label}
        </h2>
      </div>
      <div className="mh-week-grid cx-glass" ref={scroller}>
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
            <span className="mh-week-gutter">{k('allDay')}</span>
            {days.map((day) => {
              const key = dayKey(day);
              return (
                <div key={key} className="mh-week-allday-cell">
                  {allDay
                    .filter((row) => allDayKeys(row).includes(key))
                    .map((row) => (
                      <WeekBlock
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
            >
              {layoutDay(rows, day, now, isLive).map((block) => (
                <WeekBlock
                  key={block.row.key}
                  row={block.row}
                  block={block}
                  live={isLive(block.row)}
                  onSelect={onSelect}
                  when={blockTime(block, day, locale)}
                />
              ))}
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
    </section>
  );
}

/** "09:00–10:00" for the part of the block on this day. */
function blockTime(block: Block, day: Date, locale: string) {
  const at = (minutes: number) =>
    minutes >= 24 * 60
      ? clockTime(nextDay(day), locale)
      : clockTime(new Date(day.getTime() + minutes * 60_000), locale);
  const start = block.row.start! < day ? at(0) : clockTime(block.row.start!, locale);
  return `${start}–${at(block.bottom)}`;
}

function WeekBlock({
  row,
  block,
  live,
  when,
  onSelect,
}: {
  row: MeetingRow;
  block?: Block;
  live: boolean;
  when: string;
  onSelect: (row: MeetingRow) => void;
}) {
  const { t } = useTranslation();
  const event = row.kind === 'recording' ? null : row.event;
  const colour = useEventColour(event);
  const tinted = colour && !live;
  const title = row.title || t('meetingsHub.untitled');
  const height = block ? px(block.bottom - block.top) : 0;
  const position: CSSProperties | undefined = block && {
    top: px(block.top),
    height: Math.max(height - 2, 12),
    left: `calc(${(block.lane / block.lanes) * 100}% + 2px)`,
    width: `calc(${100 / block.lanes}% - 4px)`,
  };
  const organizer = event?.organizer?.name || event?.organizer?.email;
  return (
    <button
      type="button"
      className="mh-week-ev"
      data-category={tinted ? OUTLOOK_PRESETS[colour.preset] : undefined}
      data-tone={live ? 'live' : event && !colour ? 'event' : undefined}
      data-cancelled={event?.cancelled || undefined}
      data-key={row.key}
      style={{ ...(tinted ? colourStyle(colour.preset) : {}), ...position }}
      title={`${when} ${title}`}
      aria-label={[when, title, colour && t('outlookCategories.mark', { name: colour.name })]
        .filter(Boolean)
        .join(', ')}
      onClick={() => onSelect(row)}
    >
      <b>{title}</b>
      {block && height >= 34 && <span className="mh-week-ev-meta">{when}</span>}
      {block && height >= 52 && organizer && <span className="mh-week-ev-meta">{organizer}</span>}
    </button>
  );
}
