import type { CSSProperties, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { nextDay } from '../sessions/sessionDates';
import type { MeetingRow } from './meetingRows';
import { clockTime } from './format';
import { OUTLOOK_PRESETS, colourStyle, useEventColour } from '../agenda/categories';
import { HOUR_PX, type Block } from './weekLayout';

export const px = (minutes: number) => (minutes / 60) * HOUR_PX;

export type GridActions = {
  onSelect: (row: MeetingRow) => void;
  /** Double click or Enter: the full meeting page (spec 0107). */
  onOpen?: (row: MeetingRow) => void;
  selectedKey?: string | null;
  /** While the peek asks which event a recording is (spec 0111): only these stay in colour. */
  focusKeys?: string[] | null;
};

/** Click selects (the peek opens); double click or Enter opens the meeting. */
export function itemHandlers(row: MeetingRow, actions: GridActions) {
  const open = actions.onOpen;
  return {
    onClick: () => actions.onSelect(row),
    onDoubleClick: open ? () => open(row) : undefined,
    onKeyDown: open
      ? (event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          open(row);
        }
      : undefined,
    'aria-expanded':
      actions.selectedKey === undefined ? undefined : actions.selectedKey === row.key,
    'data-selected': actions.selectedKey === row.key || undefined,
    'data-dimmed': (actions.focusKeys && !actions.focusKeys.includes(row.key)) || undefined,
    'data-candidate':
      (actions.focusKeys?.includes(row.key) && actions.selectedKey !== row.key) || undefined,
  };
}

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
  ...actions
}: GridActions & {
  row: MeetingRow;
  block?: Block;
  live: boolean;
  when: string;
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
      {...itemHandlers(row, actions)}
    >
      <b>{title}</b>
      {block && height >= 34 && <span className="mh-week-ev-meta">{when}</span>}
      {block && height >= 52 && organizer && <span className="mh-week-ev-meta">{organizer}</span>}
    </button>
  );
}
