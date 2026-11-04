import { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useCaptureStore } from '../capture/captureStore';
import { useSessions, type Session } from '../sessions/sessions';
import { AgendaPanel } from './AgendaPanel';
import { formatLongDate, formatTime } from './format';
import {
  greetingPeriod,
  mergeAgenda,
  nextRow,
  reviewGroups,
  weekStats,
  type AgendaRow,
} from './hojeData';
import { NotesPanel, ReviewPanel } from './SidePanels';
import { useBoardPreview, useCalendarSnapshot, useRecentNotes } from './useHojeData';
import { WeekPanel, WorkspacePreview } from './WorkspacePreview';
import './hoje.css';

/** Re-render each minute so the greeting, "next" and live rows stay current. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * Hoje (spec 0096 P3): greeting, the day's finding, today's agenda, what to
 * review, recent notes, a Workspace preview that zooms into the board, and
 * the week's recorded time. Only real vault data; a fresh vault shows calm
 * empty states.
 */
export function HojeRoute() {
  const { t } = useTranslation();
  const now = useNow();
  const sessions = useSessions();
  const [calendar, retryCalendar] = useCalendarSnapshot();
  const [board, retryBoard] = useBoardPreview();
  const notes = useRecentNotes();

  const sessionRows = useMemo(() => sessions.data ?? [], [sessions.data]);
  const events = useMemo(() => (calendar.kind === 'ready' ? calendar.data.events : []), [calendar]);
  const agenda = useMemo(() => mergeAgenda(sessionRows, events, now), [sessionRows, events, now]);
  const review = useMemo(() => reviewGroups(sessionRows), [sessionRows]);
  const week = useMemo(() => weekStats(sessionRows, now), [sessionRows, now]);
  const sessionsState = sessions.data ? 'ready' : sessions.isError ? 'error' : 'loading';
  const retrySessions = () => void sessions.refetch();
  const pending = review.reduce((n, g) => n + g.sessions.length, 0);
  const period = greetingPeriod(now);

  return (
    <div className="cx-hoje">
      <div className="cx-hoje-wrap">
        <h1 className="cx-hoje-greeting">
          {/* No name: the config and the OS expose none to the app today. */}
          {t(`hoje.greeting.${period}`)}
        </h1>
        <Lede
          now={now}
          agenda={sessionsState === 'ready' ? agenda : null}
          sessions={sessionRows}
          pending={pending}
        />
        <div className="cx-hoje-grid">
          <AgendaPanel
            rows={agenda}
            now={now}
            sessionsState={sessionsState}
            onRetrySessions={retrySessions}
            calendarState={calendar.kind}
            outlookConnected={calendar.kind === 'ready' && !!calendar.data.account}
            onRetryCalendar={retryCalendar}
          />
          <ReviewPanel groups={review} state={sessionsState} onRetry={retrySessions} />
          <NotesPanel
            notes={notes.notes}
            now={now}
            loading={notes.loading}
            failed={notes.failed}
            onRetry={notes.retry}
          />
          <WorkspacePreview state={board} onRetry={retryBoard} />
          <WeekPanel stats={week} state={sessionsState} onRetry={retrySessions} />
        </div>
      </div>
    </div>
  );
}

type LedeProps = {
  now: Date;
  /** Null until meetings load: the lede never claims an empty day it cannot see. */
  agenda: AgendaRow[] | null;
  sessions: Session[];
  pending: number;
};

/** One line with the day's finding. Live comes from the capture store only. */
function Lede({ now, agenda, sessions, pending }: LedeProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const liveTitle = useCaptureStore((s) => {
    const active = s.status?.active;
    if (!active) return null;
    return (
      s.liveSession?.title || sessions.find((x) => x.meeting_id === active.meetingId)?.title || ''
    );
  });
  const next = agenda && nextRow(agenda, now);
  const b = { b: <b /> };
  return (
    <p className="cx-hoje-lede" data-testid="hoje-lede">
      {t('hoje.lede.date', { date: formatLongDate(now, locale) })}{' '}
      {liveTitle !== null && (
        <>
          {liveTitle ? (
            <Trans i18nKey="hoje.lede.live" values={{ title: liveTitle }} components={b} />
          ) : (
            <Trans i18nKey="hoje.lede.liveUntitled" components={b} />
          )}{' '}
        </>
      )}
      {!agenda ? null : agenda.length === 0 ? (
        t('hoje.lede.noMeetings')
      ) : next?.start ? (
        <Trans
          i18nKey="hoje.lede.meetingsNext"
          count={agenda.length}
          values={{ count: agenda.length, time: formatTime(next.start, locale) }}
          components={b}
        />
      ) : (
        <Trans
          i18nKey="hoje.lede.meetingsDone"
          count={agenda.length}
          values={{ count: agenda.length }}
          components={b}
        />
      )}
      {pending > 0 && (
        <>
          {' '}
          <Trans
            i18nKey="hoje.lede.pending"
            count={pending}
            values={{ count: pending }}
            components={b}
          />
        </>
      )}
    </p>
  );
}
