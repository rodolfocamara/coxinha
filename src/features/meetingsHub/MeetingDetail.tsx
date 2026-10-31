import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Mic } from 'lucide-react';
import { Alert, Button } from '../../components/ui';
import { library, type CaptureStatus } from '../meetings/library';
import { RecordingDetail } from '../meetings/RecordingDetail';
import { SessionNotes } from '../sessions/SessionNotes';
import { refreshSessionList, sessions, type Session } from '../sessions/sessions';
import { useCaptureStore, useIsLive } from '../capture/captureStore';
import { LiveBadge } from '../capture/LiveBadge';
import type { CalendarEvent } from '../agenda/calendar';
import { matchEvent, type MeetingRow } from './meetingRows';
import { buildLanes } from './lanes';
import { untilLabel, whenLabel } from './format';
import { MeetingHeading } from './MeetingHeading';
import { FindingBanner, findingFor } from './FindingBanner';
import { SpeakerLanes } from './SpeakerLanes';
import { MeetingInspector } from './MeetingInspector';
import { TabBar } from './TabBar';
import { MediaPlaceholder, NotesPlaceholder } from './DetailPlaceholders';
import { useMeetingMedia } from './useMeetingMedia';
import { useMeetingActions } from './useMeetingActions';

type Row<K extends MeetingRow['kind']> = Extract<MeetingRow, { kind: K }>;
export type DetailTarget =
  | { kind: 'session'; sessionId: string; row: Row<'session'> | null }
  | { kind: 'event'; row: Row<'event'> }
  | { kind: 'recording'; row: Row<'recording'> };
type Tab = 'notes' | 'transcript' | 'people';

type Props = {
  target: DetailTarget;
  events: CalendarEvent[];
  now: Date;
  onOpenSession: (sessionId: string) => void;
  onImport: (title: string) => void;
  onParticipants: (meetingId: string, event: CalendarEvent | null) => void;
  participantsRevision: number;
};

/** Session detail is loaded by ID so a session created a moment ago opens at once. */
export function MeetingDetail(props: Props) {
  const { t } = useTranslation();
  const { target } = props;
  const sessionId = target.kind === 'session' ? target.sessionId : null;
  const query = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessions.detail(sessionId!),
    enabled: !!sessionId && sessions.available(),
    retry: false,
    refetchInterval: 3000,
  });
  const session = target.kind === 'session' ? (query.data ?? target.row?.session ?? null) : null;
  if (target.kind === 'session' && !session)
    return (
      <div className="mh-detail p-6">
        {query.isError ? (
          <Alert
            tone="error"
            action={
              <Button size="sm" onClick={() => void query.refetch()}>
                {t('meetingsHub.retry')}
              </Button>
            }
          >
            {t('meetingsHub.detailFailed')}
          </Alert>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {t('meetingsHub.loading')}
          </p>
        )}
      </div>
    );
  return (
    <LoadedDetail
      {...props}
      session={session}
      staleError={query.isError}
      refetch={async () => {
        if (sessionId) await query.refetch();
        await refreshSessionList();
      }}
    />
  );
}

function LoadedDetail({
  target,
  events,
  now,
  onOpenSession,
  onImport,
  onParticipants,
  participantsRevision,
  session,
  staleError,
  refetch,
}: Props & { session: Session | null; staleError: boolean; refetch: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const k = (key: string, options?: Record<string, unknown>) => t(`meetingsHub.${key}`, options);
  const [tab, setTab] = useState<Tab>(target.kind === 'recording' ? 'transcript' : 'notes');
  const [playback, setPlayback] = useState(false);
  const seekRef = useRef<((track: string, seconds: number) => void) | null>(null);
  const event =
    target.kind === 'event'
      ? target.row.event
      : target.kind === 'session'
        ? (target.row?.event ?? (session ? matchEvent(session, events) : null))
        : null;
  const recordingMeta =
    target.kind === 'recording' ? target.row.recording : (session?.recording ?? null);
  // A capture started here knows its recording before the session refetches.
  const liveMeeting = useCaptureStore((s) =>
    session && s.liveSession?.sessionId === session.id
      ? (s.status?.active?.meetingId ?? null)
      : null
  );
  const meetingId =
    target.kind === 'recording' ? target.row.recording.id : (session?.meeting_id ?? liveMeeting);
  const live = useIsLive(session ?? (meetingId ? { id: '', meeting_id: meetingId } : null));
  const storeStatus = useCaptureStore((s) => s.status);
  const status: CaptureStatus = storeStatus ?? { active: null, error: null };
  const captureBusy = useCaptureStore((s) => s.busy !== null);
  const media = useMeetingMedia(meetingId, recordingMeta?.captureState);
  const captureState = media.detail?.meeting.captureState ?? recordingMeta?.captureState;
  const processingHere = !!meetingId && status.processing?.meetingId === meetingId;
  const report = media.processing?.report ?? null;
  const latestJob = media.processing?.jobs[0];
  const { lanes, totalMs, unconfirmed } = buildLanes(report, media.detail?.storage?.durationMs);
  const start = target.kind === 'session' ? (target.row?.start ?? null) : target.row.start;
  const end = target.kind === 'session' ? (target.row?.end ?? null) : target.row.end;
  const startDate = start ?? (session?.starts_at ? new Date(session.starts_at) : null);
  const endDate = end ?? (session?.ends_at ? new Date(session.ends_at) : null);
  const title = session?.title ?? (target.kind === 'session' ? '' : target.row.title);

  const actions = useMeetingActions({
    session,
    event: target.kind === 'event' ? target.row.event : null,
    meetingId,
    onOpenSession,
    onChooseConfig: () => {
      setTab('transcript');
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>('[data-processing-config]')?.focus()
      );
    },
    afterRecover: async (detail) => {
      media.setDetail(detail);
      media.reloadProcessing();
      await refetch();
    },
    afterProcess: media.reloadProcessing,
  });

  const canRecord =
    library.available() &&
    target.kind !== 'recording' &&
    !live &&
    !status.active &&
    !status.processing &&
    (!meetingId || captureState === 'new');
  const plannedOpen = !endDate || endDate > now || (!!startDate && startDate > now);
  const finding = findingFor({
    live,
    meetingId,
    captureState,
    processingHere,
    processing: media.processing,
    unconfirmed,
    durationMs: media.detail?.storage?.durationMs ?? null,
    planned:
      !meetingId && plannedOpen && (target.kind === 'event' || !session?.personal_note)
        ? { until: untilLabel(startDate, now, t), people: event?.attendees.length ?? 0 }
        : null,
  });
  const transcriptLabel = live
    ? k('inspector.transcriptLive')
    : processingHere || (latestJob && ['queued', 'running'].includes(latestJob.state))
      ? k('inspector.transcriptRunning')
      : report
        ? k('inspector.transcriptReady')
        : latestJob?.state === 'failed'
          ? k('inspector.transcriptFailed')
          : meetingId
            ? k('inspector.transcriptNone')
            : '–';
  const canTranscribeAgain =
    !!meetingId && captureState === 'finished' && !live && !processingHere && !!latestJob;

  const panel = (id: Tab, children: ReactNode) => (
    <section
      key={id}
      id={`session-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`session-tab-${id}`}
      tabIndex={0}
      hidden={tab !== id}
      className="mh-panel"
    >
      {tab === id && children}
    </section>
  );
  const notes = session ? (
    <SessionNotes sessionId={session.id} />
  ) : (
    <NotesPlaceholder
      kind={target.kind === 'event' ? 'event' : 'recording'}
      busy={actions.busy}
      onPrepare={actions.prepareNotes}
    />
  );
  const noMedia = (id: 'transcript' | 'people') => (
    <MediaPlaceholder
      tab={id}
      hasRecording={!!meetingId}
      failed={media.detailFailed}
      onRetry={media.retryDetail}
    />
  );

  return (
    <article className="mh-detail mh-enter" aria-labelledby="meeting-title">
      <div className="mh-dh">
        <MeetingHeading
          title={title}
          session={session}
          refresh={refetch}
          actions={
            canRecord ? (
              <Button
                variant="primary"
                icon={<Mic size={14} aria-hidden="true" />}
                disabled={captureBusy || actions.busy}
                onClick={actions.record}
              >
                {k('recordThis')}
              </Button>
            ) : live && session ? (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <LiveBadge session={session} />
                {k('controlsInStrip')}
              </span>
            ) : null
          }
        />
        <p className="mh-sub">
          <span>{whenLabel(startDate, endDate, now, locale, t)}</span>
          <span aria-hidden="true">·</span>
          {event ? (
            <>
              <span className="mh-pill" data-tone="info">
                {k('outlook')}
              </span>
              <span className="truncate">{event.title}</span>
            </>
          ) : (
            <span>{k(target.kind === 'recording' ? 'recordingOnly' : 'noEventLinked')}</span>
          )}
        </p>
        {staleError && (
          <p role="status" className="mt-2 text-xs text-warning">
            {k('stale')}
          </p>
        )}
        <FindingBanner
          finding={finding}
          busy={actions.busy}
          onRecover={actions.recover}
          onTranscribe={actions.transcribe}
          onReview={() => setTab('people')}
        />
        {actions.error && (
          <div className="mt-2">
            <Alert tone="error">{actions.error}</Alert>
          </div>
        )}
        <SpeakerLanes
          lanes={lanes}
          totalMs={totalMs}
          onSeek={
            media.detail?.audio
              ? (track, seconds) => {
                  if (tab === 'notes') setTab('transcript');
                  setPlayback(true);
                  requestAnimationFrame(() => seekRef.current?.(track, seconds));
                }
              : undefined
          }
        />
      </div>
      <TabBar<Tab>
        idPrefix="session"
        label={k('detailTabs')}
        value={tab}
        onChange={setTab}
        className="mh-dtabs"
        tabs={[
          { id: 'notes', label: k('tabs.notes') },
          { id: 'transcript', label: k(live ? 'tabs.live' : 'tabs.transcript') },
          {
            id: 'people',
            label: (
              <>
                {k('tabs.people')}
                {unconfirmed > 0 && (
                  <span className="mh-pill" data-tone="warning">
                    {unconfirmed}
                  </span>
                )}
              </>
            ),
          },
        ]}
      />
      <div className="mh-dbody">
        <div className="mh-pane">
          {panel('notes', notes)}
          {live && tab === 'transcript' && (
            <p className="mh-live-note cx-rise" role="status">
              {k('liveTranscript')}
            </p>
          )}
          {meetingId && media.detail ? (
            <>
              <div hidden={tab === 'notes'}>
                <RecordingDetail
                  detail={media.detail}
                  status={status}
                  onStatus={(next) => useCaptureStore.setState({ status: next })}
                  compact
                  audioExpanded={tab === 'transcript' || playback}
                  onRevealAudio={() => setPlayback(true)}
                  audioPanelId="meeting-playback"
                  showProcessing={tab === 'transcript'}
                  people={tab === 'people'}
                  playbackScope={tab}
                  onTranscript={() => setTab('transcript')}
                  processingPanelId="session-panel-transcript"
                  onRecover={async () => actions.recover()}
                  showRecover={false}
                  seekRef={seekRef}
                />
              </div>
              <section
                id={tab === 'people' ? 'session-panel-transcript' : 'session-panel-people'}
                role="tabpanel"
                aria-labelledby={tab === 'people' ? 'session-tab-transcript' : 'session-tab-people'}
                hidden
              />
            </>
          ) : (
            <>
              {panel('transcript', noMedia('transcript'))}
              {panel('people', noMedia('people'))}
            </>
          )}
        </div>
        <MeetingInspector
          start={startDate}
          end={endDate}
          now={now}
          event={event}
          source={target.kind === 'recording' ? 'recording' : target.kind}
          meetingId={meetingId}
          detail={media.detail}
          live={live}
          liveElapsedMs={live ? (status.active?.elapsedMs ?? null) : null}
          transcript={transcriptLabel}
          lanes={lanes}
          participantsRevision={participantsRevision}
          onAddParticipant={meetingId ? () => onParticipants(meetingId, event) : null}
          onImport={() => onImport(title)}
          onTranscribeAgain={canTranscribeAgain ? actions.transcribe : null}
        />
      </div>
    </article>
  );
}
