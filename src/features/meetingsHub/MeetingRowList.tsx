import { useTranslation } from 'react-i18next';
import { LiveBadge } from '../capture/LiveBadge';
import { attendeesOf, scheduledMs, type Attention, type MeetingRow } from './meetingRows';
import { durationLabel, rowTime } from './format';
import { localDay, nextDay } from '../sessions/sessionDates';
import { markProps, useEventColour } from '../agenda/categories';
import { CategoryLabel } from '../agenda/CategoryLabel';

type Props = {
  rows: MeetingRow[];
  selectedKey?: string | null;
  onSelect: (row: MeetingRow) => void;
  isLive: (row: MeetingRow) => boolean;
  attention: (row: MeetingRow) => Attention;
  now: Date;
};

/** Meetings as rows with their state: the "A revisar" sheet (spec 0107). */
export function MeetingRowList(p: Props) {
  return (
    <ul className="mh-rowlist">
      {p.rows.map((row) => (
        <li key={row.key}>
          <RowButton row={row} {...p} />
        </li>
      ))}
    </ul>
  );
}

function RowButton({ row, ...p }: Props & { row: MeetingRow }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const selected = p.selectedKey === row.key;
  const colour = useEventColour(row.kind === 'recording' ? null : row.event);
  return (
    <button
      type="button"
      className="mh-row cx-cat-mark"
      data-key={row.key}
      aria-current={selected ? 'true' : undefined}
      onClick={() => p.onSelect(row)}
      {...markProps(colour)}
    >
      <b className="mh-row-title" data-row-title>
        {row.title || t('meetingsHub.untitled')}
      </b>
      <CategoryLabel colour={colour} />
      <span className="mh-row-time">{rowTime(row.start, p.now, locale)}</span>
      <span className="mh-row-meta">
        <RowMeta row={row} live={p.isLive(row)} attention={p.attention(row)} now={p.now} />
      </span>
    </button>
  );
}

function RowMeta({
  row,
  live,
  attention,
  now,
}: {
  row: MeetingRow;
  live: boolean;
  attention: Attention;
  now: Date;
}) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) => t(`meetingsHub.${key}`, options);
  const people = attendeesOf(row).length;
  const outlook =
    row.kind !== 'recording' && row.event
      ? people
        ? k('outlookPeople', { count: people })
        : k('outlook')
      : null;
  const endOfToday = nextDay(localDay(now.getFullYear(), now.getMonth(), now.getDate()));
  const started = !row.start || row.start < endOfToday;
  const parts: { text: string; tone?: 'live' | 'warning' }[] = [];
  const duration = scheduledMs(row);
  if (live && row.kind !== 'event') {
    return (
      <>
        <LiveBadge
          session={row.kind === 'session' ? row.session : { id: '', meeting_id: row.recording.id }}
        />
        {outlook && <span>{outlook}</span>}
      </>
    );
  }
  if (row.kind === 'event') {
    if (row.event.cancelled) parts.push({ text: k('cancelled') });
    else if (outlook) parts.push({ text: outlook });
    if (started && !row.event.cancelled) parts.push({ text: k('noRecording') });
  } else if (row.kind === 'recording') {
    parts.push({ text: k('recordingOnly') });
  } else {
    const hasRecording = !!row.session.meeting_id;
    if (hasRecording && duration) parts.push({ text: durationLabel(duration, t) });
    else if (outlook) parts.push({ text: outlook });
    if (!hasRecording && started) parts.push({ text: k('noRecording') });
  }
  if (attention === 'recover') parts.push({ text: k('interrupted'), tone: 'live' });
  if (attention === 'processing') parts.push({ text: k('transcribing') });
  if (attention === 'failed') parts.push({ text: k('transcriptFailed'), tone: 'live' });
  if (attention === 'untranscribed') parts.push({ text: k('noTranscript') });
  return (
    <>
      {parts.map((part) => (
        <span key={part.text} data-tone={part.tone}>
          {part.text}
        </span>
      ))}
    </>
  );
}
