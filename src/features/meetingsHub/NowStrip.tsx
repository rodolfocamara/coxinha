import { useTranslation } from 'react-i18next';
import { ClipboardList, Mic } from 'lucide-react';
import { Button } from '../../components/ui';
import { library } from '../meetings/library';
import { LiveBadge } from '../capture/LiveBadge';
import { useCaptureStore } from '../capture/captureStore';
import { useEventColour } from '../agenda/categories';
import { attendeesOf, type MeetingRow } from './meetingRows';
import { clockTime } from './format';
import { nowAndNext } from './calendarHomeModel';
import { useMeetingActions } from './useMeetingActions';

type Props = {
  rows: MeetingRow[];
  now: Date;
  isLive: (row: MeetingRow) => boolean;
  /** The card itself: the peek. */
  onSelect: (row: MeetingRow) => void;
  /** Its button: the full meeting page. */
  onOpen: (row: MeetingRow) => void;
  onOpenSession: (sessionId: string) => void;
};

/** "Agora / A seguir" above the calendar (spec 0107); hidden when the day is quiet. */
export function NowStrip({ rows, now, isLive, onSelect, onOpen, onOpenSession }: Props) {
  const { t } = useTranslation();
  const { current, next } = nowAndNext(rows, now, isLive);
  if (!current && !next) return null;
  return (
    <section className="ch-strip" aria-label={t('meetingsHub.home.nowAndNext')}>
      {current && (
        <StripCard
          row={current}
          kind="now"
          now={now}
          live={isLive(current)}
          onSelect={onSelect}
          onOpen={onOpen}
          onOpenSession={onOpenSession}
        />
      )}
      {next && (
        <StripCard
          row={next}
          kind="next"
          now={now}
          live={false}
          onSelect={onSelect}
          onOpen={onOpen}
          onOpenSession={onOpenSession}
        />
      )}
    </section>
  );
}

function StripCard({
  row,
  kind,
  now,
  live,
  onSelect,
  onOpen,
  onOpenSession,
}: {
  row: MeetingRow;
  kind: 'now' | 'next';
  now: Date;
  live: boolean;
  onSelect: (row: MeetingRow) => void;
  onOpen: (row: MeetingRow) => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.home.${key}`, options);
  const session = row.kind === 'session' ? row.session : null;
  const event = row.kind === 'recording' ? null : row.event;
  const colour = useEventColour(event);
  const capture = useCaptureStore((s) => s.status);
  const actions = useMeetingActions({
    session,
    event: row.kind === 'event' ? row.event : null,
    meetingId: session?.meeting_id ?? (row.kind === 'recording' ? row.recording.id : null),
    onOpenSession,
    onChooseConfig: () => onOpen(row),
    afterRecover: async () => undefined,
    afterProcess: () => undefined,
  });
  const minutes = Math.max(1, Math.round((row.start!.getTime() - now.getTime()) / 60_000));
  const label =
    kind === 'now'
      ? k('now')
      : minutes < 60
        ? k('inMinutes', { count: minutes })
        : k('at', { time: clockTime(row.start!, locale) });
  const range = row.end
    ? `${clockTime(row.start!, locale)}–${clockTime(row.end, locale)}`
    : clockTime(row.start!, locale);
  const people = attendeesOf(row).length;
  const facts = [
    range,
    people ? t('meetingsHub.outlookPeople', { count: people }) : null,
    colour?.name ?? null,
  ].filter(Boolean);
  const canRecord =
    kind === 'now' &&
    !live &&
    library.available() &&
    row.kind !== 'recording' &&
    !capture?.active &&
    !capture?.processing &&
    !session?.meeting_id;
  const title = row.title || t('meetingsHub.untitled');
  return (
    <div className="ch-strip-card" data-kind={kind}>
      <span className="ch-strip-tag">
        {kind === 'now' && <i className="ch-strip-dot" aria-hidden="true" />}
        {label}
      </span>
      <button type="button" className="ch-strip-main" onClick={() => onSelect(row)}>
        <b>{title}</b>
        <span className="text-muted-foreground">{facts.join(' · ')}</span>
      </button>
      {live && session && <LiveBadge session={session} />}
      {canRecord ? (
        <Button
          variant="secondary"
          size="sm"
          icon={<Mic size={14} aria-hidden="true" />}
          disabled={actions.busy}
          onClick={actions.record}
          aria-label={k('recordNamed', { title })}
        >
          {k('record')}
        </Button>
      ) : kind === 'next' && row.kind === 'event' ? (
        <Button
          size="sm"
          icon={<ClipboardList size={14} aria-hidden="true" />}
          disabled={actions.busy}
          onClick={actions.prepareNotes}
          aria-label={k('prepareNamed', { title })}
        >
          {k('prepare')}
        </Button>
      ) : (
        <Button size="sm" onClick={() => onOpen(row)} aria-label={k('openNamed', { title })}>
          {k(kind === 'next' ? 'prepare' : 'open')}
        </Button>
      )}
    </div>
  );
}
