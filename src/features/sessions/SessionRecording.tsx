import { useCaptureDevices } from '../meetings/useCaptureDevices';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, FolderInput, Pause, Play, Square } from 'lucide-react';
import { Alert, Button, ButtonLink } from '../../components/ui';
import { useTranslation } from 'react-i18next';
import { CaptureSection } from '../meetings/CaptureSection';
import { RecordingDetail } from '../meetings/RecordingDetail';
import { RecordingInformation } from '../meetings/RecordingInformation';
import { library, type CaptureStatus, type LibraryDetail } from '../meetings/library';
import { type Session } from './sessions';
import { startSessionCapture, useAcknowledgedSessionCapture } from './sessionCapture';

type FailureSource = 'detail' | 'status' | 'action' | 'sources' | 'refresh';

export function SessionRecording({
  session,
  transcript,
  people = false,
  playbackScope,
  onTranscript,
  refresh,
}: {
  session: Session;
  transcript: boolean;
  people?: boolean;
  playbackScope?: string;
  onTranscript?: () => void;
  refresh: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CaptureStatus>({ active: null, error: null });
  const [detail, setDetail] = useState<LibraryDetail | null>(null);
  const [capture, setCapture] = useState(false);
  const [playback, setPlayback] = useState(false);
  const acknowledgedMeeting = useAcknowledgedSessionCapture(session.id);
  const {
    sources,
    setSources,
    mic,
    setMic,
    output,
    setOutput,
    loading: devicesLoading,
    failed: devicesFailed,
    refreshSources,
  } = useCaptureDevices();
  const [errors, setErrors] = useState<Partial<Record<FailureSource, boolean>>>({});
  const failure = useCallback((source: FailureSource, failed: boolean) => {
    setErrors((previous) => ({ ...previous, [source]: failed }));
  }, []);
  const error = Object.values(errors).some(Boolean);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const actionPending = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    let live = true;
    setDetail(null);
    if (!session.meeting_id) failure('detail', false);
    if (session.meeting_id)
      void library
        .detail(session.meeting_id)
        .then((d) => {
          if (live) {
            setDetail(d);
            failure('detail', false);
          }
        })
        .catch(() => {
          if (live) failure('detail', true);
        });
    return () => {
      live = false;
    };
  }, [session.meeting_id, session.recording?.captureState, attempt, failure]);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const observedRevision = revision.current;
      try {
        const next = await library.status();
        if (live && observedRevision === revision.current && !actionPending.current) {
          setStatus(next);
          failure('status', false);
        }
      } catch {
        if (live && observedRevision === revision.current && !actionPending.current)
          failure('status', true);
      }
      if (live) timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [failure, attempt]);
  async function act(action: () => Promise<CaptureStatus>) {
    if (actionPending.current) return;
    actionPending.current = true;
    const actionRevision = ++revision.current;
    setBusy(true);
    try {
      setStatus(await action());
      failure('action', false);
      failure('status', false);
      // Acknowledged capture controls remain usable while metadata catches up.
      void refreshMetadata(actionRevision);
    } catch {
      failure('action', true);
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }
  async function refreshMetadata(observedRevision = revision.current) {
    try {
      await refresh();
      if (revision.current === observedRevision) failure('refresh', false);
    } catch {
      if (revision.current === observedRevision) failure('refresh', true);
    }
  }
  async function loadSources() {
    try {
      setSources(await library.sources());
      failure('sources', false);
    } catch {
      failure('sources', true);
    }
  }
  const ownedMeeting = session.meeting_id ?? acknowledgedMeeting;
  const ownsActive = !!ownedMeeting && status.active?.meetingId === ownedMeeting;
  const hasFinishedRecording =
    (session.recording && ['finished', 'interrupted'].includes(session.recording.captureState)) ||
    (!!acknowledgedMeeting && !!ownedMeeting && !status.active);
  return (
    <section className="space-y-2" aria-label={t('session.audio')}>
      {error && (
        <Alert
          tone="error"
          action={
            <Button
              size="sm"
              onClick={() => {
                setAttempt((n) => n + 1);
                if (capture) void loadSources();
                void refreshMetadata();
              }}
            >
              {t('session.retry')}
            </Button>
          }
        >
          {t(ownsActive ? 'session.activeAudioFailed' : 'session.audioFailed')}
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-border py-2 text-xs text-muted-foreground">
        <span className={ownsActive ? 'font-medium text-foreground mr-auto' : 'mr-auto'}>
          {ownsActive
            ? t(status.active?.paused ? 'session.paused' : 'library.state.recording')
            : session.recording
              ? t(`library.state.${session.recording.captureState}`)
              : t(ownedMeeting ? 'session.recordingPending' : 'session.noAudioCompact')}
        </span>
        {ownsActive && (
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label={t('recordingLayout.transport')}
          >
            <Button
              size="sm"
              icon={
                status.active?.paused ? (
                  <Play size={14} aria-hidden="true" />
                ) : (
                  <Pause size={14} aria-hidden="true" />
                )
              }
              disabled={busy}
              onClick={() => void act(() => library.pause(!status.active?.paused))}
            >
              {t(status.active?.paused ? 'library.resume' : 'library.pause')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Square size={14} aria-hidden="true" />}
              disabled={busy}
              onClick={() => void act(library.stop)}
            >
              {t('library.stop')}
            </Button>
          </div>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={capture ? 'rotate-180 transition-transform' : 'transition-transform'}
            />
          }
          aria-expanded={capture}
          onClick={() => {
            setCapture(!capture);
            if (!capture) void loadSources();
          }}
        >
          {t('session.capture')}
        </Button>
        {detail?.audio && Object.keys(detail.audio).length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            aria-controls="session-playback"
            aria-expanded={playback}
            onClick={() => setPlayback((v) => !v)}
          >
            {t('session.playback')}
          </Button>
        )}
      </div>
      <RecordingInformation
        storage={ownsActive ? status.active?.storage : detail?.storage}
        elapsedMs={ownsActive ? status.active?.elapsedMs : undefined}
        processing={
          status.processing?.meetingId === ownedMeeting ? status.processing?.phase : undefined
        }
      />
      {capture && (
        <>
          {status.active && !ownsActive && !busy ? (
            <Alert tone="info">{t('session.otherCapture')}</Alert>
          ) : (
            <>
              {hasFinishedRecording && !ownsActive && (
                <p role="status" className="text-xs text-muted-foreground">
                  {t('session.recordingExists')}
                </p>
              )}
              <CaptureSection
                fixedTitle
                showActions={!ownsActive}
                allowImport={false}
                desktop={
                  library.available() &&
                  (!ownedMeeting ||
                    (session.recording?.captureState === 'new' && !acknowledgedMeeting) ||
                    ownsActive)
                }
                sources={sources}
                devicesLoading={devicesLoading}
                devicesFailed={devicesFailed}
                onRefreshDevices={() => void refreshSources()}
                onSystemDefaults={() => void refreshSources(true)}
                status={status}
                busy={busy}
                title={session.title}
                mic={mic}
                output={output}
                setTitle={() => {}}
                setMic={setMic}
                setOutput={setOutput}
                onStart={() => void act(() => startSessionCapture(session.id, mic, output))}
                onPause={() => void act(() => library.pause(!status.active?.paused))}
                onStop={() => void act(library.stop)}
                onImport={() => {}}
              />
            </>
          )}
          {ownsActive ? (
            <p className="text-xs text-muted-foreground">{t('session.ownedCaptureHelp')}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <p>
                {!ownedMeeting && <>{t('session.noAudio')} </>}
                {t('session.importSeparate')}
              </p>
              <ButtonLink
                to="/meetings"
                size="sm"
                icon={<FolderInput size={14} aria-hidden="true" />}
              >
                {t('session.captureUtility')}
              </ButtonLink>
            </div>
          )}
        </>
      )}
      {ownedMeeting && !detail && (
        <section
          id={people ? 'session-panel-people' : 'session-panel-transcript'}
          role="tabpanel"
          aria-labelledby={people ? 'session-tab-people' : 'session-tab-transcript'}
          tabIndex={0}
          hidden={!transcript && !people}
        >
          <p role="status">
            {t(errors.detail && !ownsActive ? 'session.audioFailed' : 'session.transcriptPending')}
          </p>
        </section>
      )}
      {ownedMeeting && (
        <section
          id={people ? 'session-panel-transcript' : 'session-panel-people'}
          role="tabpanel"
          aria-labelledby={people ? 'session-tab-transcript' : 'session-tab-people'}
          hidden
        />
      )}
      {detail && (
        <RecordingDetail
          detail={detail}
          status={status}
          onStatus={setStatus}
          compact
          audioExpanded={playback}
          onRevealAudio={() => setPlayback(true)}
          audioPanelId="session-playback"
          showProcessing={transcript}
          people={people}
          playbackScope={playbackScope}
          onTranscript={onTranscript}
          processingPanelId="session-panel-transcript"
          onRecover={async () => {
            setDetail(await library.recover(detail.meeting.id));
            await refresh();
          }}
        />
      )}
    </section>
  );
}
