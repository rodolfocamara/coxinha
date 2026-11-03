import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { nextDay } from '../sessions/sessionDates';
import type { MeetingRow } from './meetingRows';
import { clockTime } from './format';
import { OUTLOOK_PRESETS, colourStyle, useEventColour } from '../agenda/categories';
import { HOUR_PX, type Block } from './weekLayout';

export const px = (minutes: number) => (minutes / 60) * HOUR_PX;

/** "09:00–10:00" for the part of the block on this day. */
export function blockTime(block: Block, day: Date, locale: string) {
  const at = (minutes: number) =>
    minutes >= 24 * 60
      ? clockTime(nextDay(day), locale)
      : clockTime(new Date(day.getTime() + minutes * 60_000), locale);
  const start = block.row.start! < day ? at(0) : clockTime(block.row.start!, locale);
  return `${start}–${at(block.bottom)}`;
}

/**
 * A meeting on the time grid (spec 0104 P3): filled with its category, sized
 * by its block when it has one (all-day items have none).
 */
export function CalendarBlock({
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
