import { useNavigate, useMatchRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  AlertTriangle,
  CircleCheck,
  CircleHelp,
  CircleMinus,
  Clock,
  FileText,
  LoaderCircle,
  Mic,
  MicOff,
  StickyNote,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { Session } from './sessions';
import { dayKey, groupSessions, nextDay, sessionDate } from './sessionDates';
import { toggleSessionGroup, useSessionSidebarPreferences } from './sidebarPreferences';
import { transcriptStatus } from './sessionNavigation';
import { useAcknowledgedSessionCapture } from './sessionCapture';

function Indicator({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span title={label} className="inline-flex shrink-0 items-center gap-1">
      <span aria-hidden="true">{children}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
export function SessionEntry({
  session,
  compact = false,
}: {
  session: Session;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const match = useMatchRoute();
  const occurrence = sessionDate(session);
  const locale = i18n?.resolvedLanguage ?? i18n?.language;
  const acknowledgedMeeting = useAcknowledgedSessionCapture(session.id);
  const isRecording =
    session.recording?.captureState === 'recording' ||
    (!!acknowledgedMeeting && session.recording?.captureState !== 'finished');
  const hasAudio = !!session.recording || !!session.meeting_id || !!acknowledgedMeeting;
  const audio = session.recording
    ? t(`library.state.${session.recording.captureState}`)
    : t(hasAudio ? 'session.recordingPending' : 'sessionCalendar.noAudio');
  const coverage = transcriptStatus(session);
  const transcript = t(`sessionCalendar.transcript.${coverage}`);
  const processing = session.processing
    ? t('library.processing.running')
    : session.processing_state
      ? i18n.exists(`library.processing.state.${session.processing_state}`)
        ? t(`library.processing.state.${session.processing_state}`)
        : t('sessionCalendar.processingUnknown')
      : null;
  const failed = session.processing_state === 'failed' && !session.processing;
  const processingIcon = failed ? (
    <AlertTriangle size={13} />
  ) : session.processing || session.processing_state === 'running' ? (
    <LoaderCircle size={13} />
  ) : session.processing_state === 'succeeded' ? (
    <CircleCheck size={13} />
  ) : session.processing_state === 'pending' ? (
    <Clock size={13} />
  ) : (
    <CircleHelp size={13} />
  );
  const transcriptIcon =
    coverage === 'available' ? (
      <CircleCheck size={13} />
    ) : coverage === 'empty' ? (
      <CircleMinus size={13} />
    ) : coverage === 'none' ? (
      <FileText size={13} />
    ) : coverage === 'unavailable' ? (
      <AlertTriangle size={13} />
    ) : (
      <CircleHelp size={13} />
    );
  return (
    <button
      type="button"
      aria-current={
        match({ to: '/sessions/$sessionId', params: { sessionId: session.id } })
          ? 'page'
          : undefined
      }
      className={`block w-full min-w-0 rounded-md text-left hover:bg-secondary aria-[current=page]:bg-secondary focus-visible:outline focus-visible:outline-ring ${compact ? 'px-2 py-1.5' : 'border border-border bg-card p-3'} ${isRecording ? 'ring-1 ring-primary/40 bg-secondary/40' : ''}`}
      onClick={() =>
        void navigate({ to: '/sessions/$sessionId', params: { sessionId: session.id } })
      }
    >
      <span className="flex items-center gap-1.5 min-w-0">
        {isRecording && (
          <span
            aria-hidden="true"
            className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-destructive shrink-0"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
            REC
          </span>
        )}
        <span
          className={`block text-sm min-w-0 flex-1 ${compact ? 'truncate' : 'break-words'}`}
          title={session.title}
        >
          {session.title || t('sidebar.untitled')}
        </span>
      </span>
      {compact ? (
        <span className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          <span className="shrink-0">
            {occurrence ? (
              <>
                {occurrence.source === 'recorded' && (
                  <span title={t('sessionCalendar.recordedDate')}>
                    {t('sessionCalendar.recordedShort')}{' '}
                  </span>
                )}
                <time dateTime={occurrence.date.toISOString()}>
                  {occurrence.date.toLocaleTimeString(locale, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </>
            ) : (
              t('session.noDate')
            )}
          </span>
          <Indicator label={audio}>{hasAudio ? <Mic size={13} /> : <MicOff size={13} />}</Indicator>
          <Indicator label={transcript}>{transcriptIcon}</Indicator>
          <Indicator label={t(`session.state.${session.status}`)}>
            <Clock size={13} />
          </Indicator>
          {processing && <Indicator label={processing}>{processingIcon}</Indicator>}
          {failed && (
            <span title={processing ?? undefined} className="text-destructive">
              {t('sessionCalendar.failedShort')}
            </span>
          )}
          {session.note_error && (
            <Indicator label={t('session.noteFailed')}>
              <StickyNote size={13} />
            </Indicator>
          )}
        </span>
      ) : (
        <>
          <span className="block text-xs text-muted-foreground mt-1 break-words">
            {occurrence ? (
              <>
                {occurrence.source === 'recorded' && `${t('sessionCalendar.recordedDate')} · `}
                <time dateTime={occurrence.date.toISOString()}>
                  {occurrence.date.toLocaleString(locale)}
                </time>
              </>
            ) : (
              t('session.noDate')
            )}
          </span>
          <span className="flex items-start gap-1 mt-1 text-xs text-muted-foreground">
            <span aria-hidden="true">{hasAudio ? <Mic size={12} /> : <MicOff size={12} />}</span>
            <span>
              {audio} · {t(`session.state.${session.status}`)}
            </span>
          </span>
          <span className="flex items-start gap-1 mt-1 text-xs text-muted-foreground">
            <span aria-hidden="true">{transcriptIcon}</span>
            <span>{transcript}</span>
          </span>
          {processing && (
            <span className="block mt-1 text-xs text-muted-foreground">{processing}</span>
          )}
          {session.note_error && (
            <span className="block text-xs text-destructive">{t('session.noteFailed')}</span>
          )}
        </>
      )}
    </button>
  );
}
export function SessionGroups({ rows, compact = false }: { rows: Session[]; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const collapsed = useSessionSidebarPreferences((state) => state.groups);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  return (
    <div className={compact ? 'space-y-2' : 'space-y-4'}>
      {groupSessions(rows).map((group) => {
        const fullDate = group.date?.toLocaleDateString(locale, { dateStyle: 'full' });
        const relative =
          group.date &&
          (dayKey(group.date) === dayKey(new Date())
            ? t('sessionCalendar.today')
            : dayKey(group.date) === dayKey(nextDay(new Date(), -1))
              ? t('sessionCalendar.yesterday')
              : null);
        const label = group.date
          ? compact
            ? (relative ??
              group.date.toLocaleDateString(locale, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                ...(group.date.getFullYear() !== new Date().getFullYear()
                  ? { year: 'numeric' as const }
                  : {}),
              }))
            : fullDate
          : t('sessionCalendar.undated');
        return (
          <section key={group.key} className={compact ? 'space-y-0.5' : 'space-y-2'}>
            <h3
              aria-label={fullDate}
              className={
                compact
                  ? 'text-[11px] font-normal text-muted-foreground'
                  : 'text-xs font-medium text-muted-foreground'
              }
              title={fullDate}
            >
              {compact ? (
                <button
                  type="button"
                  className="flex items-center gap-1 w-full px-2 pt-2 pb-1 text-left focus-visible:outline focus-visible:outline-ring"
                  aria-label={fullDate ?? label}
                  aria-expanded={!collapsed.includes(group.key)}
                  onClick={() => toggleSessionGroup(group.key)}
                >
                  <ChevronRight
                    size={11}
                    aria-hidden="true"
                    className={collapsed.includes(group.key) ? '' : 'rotate-90'}
                  />
                  {label}
                </button>
              ) : (
                <span aria-label={fullDate}>{label}</span>
              )}
            </h3>
            <div
              hidden={compact && collapsed.includes(group.key)}
              className={compact ? 'space-y-0.5 ml-2 border-l border-border pl-1' : 'space-y-2'}
            >
              {group.sessions.map((session) => (
                <SessionEntry key={session.id} session={session} compact={compact} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
