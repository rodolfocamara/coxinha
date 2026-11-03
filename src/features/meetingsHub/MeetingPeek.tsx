import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Mic, X } from 'lucide-react';
import { Button } from '../../components/ui';
import { library, type CalendarMatch } from '../meetings/library';
import type { CalendarEvent } from '../agenda/calendar';
import { useCaptureStore } from '../capture/captureStore';
import { colourVar, useEventColour } from '../agenda/categories';
import { dayKey, localDay, nextDay } from '../sessions/sessionDates';
import { attendeesOf, type MeetingRow } from './meetingRows';
import { durationLabel, whenLabel } from './format';
import type { DetailPanel } from './meetingsSearch';
import { useMeetingActions } from './useMeetingActions';
import { PeekFilesAndLinks, PeekSummary, PeekTranscript } from './PeekSections';
import { PeekCalendarMatch } from './PeekCalendarMatch';
import './calendarPeek.css';

type Props = {
  row: MeetingRow;
  now: Date;
  query: string;
  live: boolean;
  onClose: () => void;
  onOpen: (row: MeetingRow, panel?: DetailPanel) => void;
  onOpenSession: (sessionId: string) => void;
  /** The Outlook cache and the open proposals, to ask which event a recording is (spec 0111). */
  events?: CalendarEvent[];
  matches?: CalendarMatch[];
  onMatchResolved?: (kept?: string) => void;
  onMatchFocus?: (eventId: string | null) => void;
};

/**
 * Outlook's preview card as a side panel (spec 0107): what a meeting has —
 * summary or notes, a transcript excerpt, files and activities — and the next
 * action for its time. Escape closes it.
 */
export function MeetingPeek({
  row,
  now,
  query,
  live,
  onClose,
  onOpen,
  onOpenSession,
  events = [],
  matches = [],
  onMatchResolved = () => undefined,
  onMatchFocus,
}: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.home.${key}`, options);
  const heading = useRef<HTMLHeadingElement>(null);
  const session = row.kind === 'session' ? row.session : null;
  const event = row.kind === 'recording' ? null : row.event;
  const meetingId = session?.meeting_id ?? (row.kind === 'recording' ? row.recording.id : null);
  const colour = useEventColour(event);
  const capture = useCaptureStore((s) => s.status);
  const detail = useQuery({
    queryKey: ['peek-detail', meetingId],
    queryFn: () => library.detail(meetingId!),
    enabled: !!meetingId && library.available(),
    retry: false,
  });
  const actions = useMeetingActions({
    session,
    event: row.kind === 'event' ? row.event : null,
    meetingId,
    onOpenSession,
    onChooseConfig: () => onOpen(row, 'transcript'),
    afterRecover: async () => undefined,
    afterProcess: () => undefined,
  });

  useEffect(() => {
    heading.current?.focus();
  }, [row.key]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      // Fields keep Escape for themselves (the search clears); dialogs and menus close first.
      if (target?.closest('input, textarea, select, [role="dialog"], [role="menu"]')) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title = row.title || t('meetingsHub.untitled');
  const people = attendeesOf(row);
  const durationMs = detail.data?.storage?.durationMs ?? null;
  const ended = !!row.end && row.end <= now;
  const started = !!row.start && row.start <= now;
  const happening = started && !ended;
  const past = ended || (!row.end && started && !!meetingId);
  const canRecord =
    happening &&
    !live &&
    library.available() &&
    row.kind !== 'recording' &&
    !capture?.active &&
    !capture?.processing &&
    !meetingId;

  return (
    <aside className="ch-peek" aria-labelledby="ch-peek-title">
      <header className="ch-peek-head">
        <span className="ch-peek-when">
          {[whenLabel(row.start, row.end, now, locale, t), relative(row.start, now, locale)]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          icon={<X size={14} aria-hidden="true" />}
          aria-label={k('closePeek')}
          onClick={onClose}
        />
      </header>
      <h2 id="ch-peek-title" ref={heading} tabIndex={-1} className="ch-peek-title">
        {title}
      </h2>
      <div className="ch-peek-chips">
        {colour && (
          <span className="ch-peek-chip" data-static="">
            <i
              className="ch-cat-swatch"
              aria-hidden="true"
              style={{ background: colourVar(colour.preset) }}
            />
            {colour.name}
          </span>
        )}
        {people.length > 0 && (
          <span className="ch-peek-chip" data-static="">
            {t('meetingsHub.outlookPeople', { count: people.length })}
          </span>
        )}
        {durationMs ? (
          <span className="ch-peek-chip" data-static="">
            {k('recorded', { duration: durationLabel(durationMs, t) })}
          </span>
        ) : null}
        {event?.cancelled && (
          <span className="ch-peek-chip" data-static="">
            {t('meetingsHub.cancelled')}
          </span>
        )}
      </div>
      {!session && event && people.length > 0 && (
        <section className="ch-peek-sec">
          <h3 className="ch-peek-h">{k('invitees')}</h3>
          <p className="ch-peek-line">
            {people
              .slice(0, 6)
              .map((p) => p.name || p.email)
              .join(', ')}
            {people.length > 6 ? ` +${people.length - 6}` : ''}
          </p>
        </section>
      )}
      {session && meetingId && !event && row.start && past && (
        <PeekCalendarMatch
          key={session.id}
          sessionId={session.id}
          start={row.start}
          durationMs={durationMs}
          events={events}
          proposal={matches.find((m) => m.sessionId === session.id) ?? null}
          onResolved={onMatchResolved}
          onFocus={onMatchFocus}
        />
      )}
      <PeekSummary meetingId={meetingId} session={session} />
      <PeekTranscript
        meetingId={meetingId}
        query={query}
        onFull={() => onOpen(row, 'transcript')}
      />
      {session && <PeekFilesAndLinks session={session} start={row.start} />}
      {actions.error && (
        <p className="ch-peek-error" role="alert">
          {actions.error}
        </p>
      )}
      <footer className="ch-peek-actions">
        {canRecord && (
          <Button
            variant="primary"
            size="sm"
            icon={<Mic size={14} aria-hidden="true" />}
            disabled={actions.busy}
            onClick={actions.record}
          >
            {k('record')}
          </Button>
        )}
        {!past && row.kind === 'event' ? (
          <Button
            variant={canRecord ? 'secondary' : 'primary'}
            size="sm"
            icon={<ClipboardList size={14} aria-hidden="true" />}
            disabled={actions.busy}
            onClick={actions.prepareNotes}
          >
            {k('prepare')}
          </Button>
        ) : (
          <Button
            variant={canRecord ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => onOpen(row)}
          >
            {k(past ? 'openMeeting' : 'prepare')}
          </Button>
        )}
      </footer>
    </aside>
  );
}

/** "ontem", "amanhã" for the neighbouring days; today is already in the date. */
function relative(start: Date | null, now: Date, locale: string) {
  if (!start) return null;
  const today = localDay(now.getFullYear(), now.getMonth(), now.getDate());
  const offset =
    dayKey(start) === dayKey(nextDay(today, -1))
      ? -1
      : dayKey(start) === dayKey(nextDay(today))
        ? 1
        : 0;
  return offset
    ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(offset, 'day')
    : null;
}
