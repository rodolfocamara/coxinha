import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle, ChevronRight, Mic, Pause, Phone, Play, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import { WindowChrome } from '../../components/AppShell/WindowChrome';
import type { ActiveCall } from '../../lib/bindings';
import { sessionListCache } from '../sessions/sessions';
import {
  acknowledgeCallEnded,
  callKey,
  dismissCall,
  trackRecordedCall,
  useMeetingDetection,
} from '../detection/meetingDetection';
import {
  recordDetectedCall,
  stopDetectedCallRecording,
  switchToDetectedCall,
  useDirectCapture,
} from '../detection/directCapture';
import { MeetingDetails } from '../detection/MeetingDetails';
import type { CalendarEvent } from '../agenda/calendar';
import { dismissCaptureError, pauseCapture, stopCapture } from './captureActions';
import { capturePhase, useCaptureStore } from './captureStore';
import '../../components/Shell/shell.css';

export function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

type Tone = 'idle' | 'live' | 'attention' | 'busy';
type View = { key: string; tone: Tone; content: ReactNode; actions?: ReactNode };

/** Title of what is being recorded: start request first, then the session list. */
function useLiveTitle() {
  const { t } = useTranslation();
  const meetingId = useCaptureStore(
    (s) => s.status?.active?.meetingId ?? s.status?.processing?.meetingId
  );
  const liveSession = useCaptureStore((s) => s.liveSession);
  const receipt = useDirectCapture((s) => s.receipt);
  const sessions = sessionListCache((s) => s.data);
  const session = meetingId ? sessions?.find((s) => s.meeting_id === meetingId) : undefined;
  return {
    title: liveSession?.title ?? receipt?.title ?? session?.title ?? t('recorder.untitled'),
    sessionId: liveSession?.sessionId ?? receipt?.sessionId ?? session?.id ?? null,
  };
}

/**
 * The only UI with capture controls (spec 0096 P1). It also hosts call
 * detection prompts and doubles as the window title bar.
 */
export function RecorderStrip() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const status = useCaptureStore((s) => s.status);
  const busy = useCaptureStore((s) => s.busy);
  const failure = useCaptureStore((s) => s.failure);
  const dismissedError = useCaptureStore((s) => s.dismissedError);
  const detection = useMeetingDetection();
  const direct = useDirectCapture();
  const { title, sessionId } = useLiveTitle();
  const phase = capturePhase(status);
  const active = status?.active;

  const openMeeting = sessionId
    ? () => void navigate({ to: '/meetings/$sessionId', params: { sessionId } })
    : undefined;
  const titleChip = (
    <button
      type="button"
      className="cx-chip"
      onClick={openMeeting ?? (() => void navigate({ to: '/meetings' }))}
      title={t('recorder.openMeeting')}
    >
      <span>{title}</span>
      <ChevronRight size={13} aria-hidden="true" />
    </button>
  );
  const stopButton = (
    <Button
      size="xs"
      variant="danger"
      icon={<Square size={13} aria-hidden="true" />}
      disabled={!!busy}
      onClick={() => void stopCapture()}
    >
      {t(busy === 'stop' ? 'recorder.stopping' : 'recorder.stop')}
    </Button>
  );

  const detecting = detection.enabled && !detection.failed && !detection.status?.unavailable;
  const nextCall: ActiveCall | undefined =
    detecting && active && detection.recordedCallKey
      ? detection.status?.calls.find(
          (c) =>
            callKey(c) !== detection.recordedCallKey && !detection.dismissed.includes(callKey(c))
        )
      : undefined;
  const pendingCall: ActiveCall | undefined =
    detecting && phase === 'idle'
      ? detection.status?.calls.find((c) => !detection.dismissed.includes(callKey(c)))
      : undefined;
  const error = status?.error && status.error !== dismissedError ? status.error : null;

  let view: View;
  if (active && nextCall) {
    view = {
      key: `next:${callKey(nextCall)}`,
      tone: 'attention',
      content: (
        <>
          <Phone size={14} aria-hidden="true" />
          <b role="alert">{t('recorder.nextCall', { app: nextCall.app_name })}</b>
          <span className="cx-strip-muted">{t('recorder.stillRecording', { title })}</span>
        </>
      ),
      actions: (
        <>
          <Button
            size="xs"
            variant="primary"
            disabled={direct.busy}
            onClick={() =>
              void switchToDetectedCall(
                nextCall,
                t('meetingDetection.newTitle', { app: nextCall.app_name })
              )
            }
          >
            {t('recorder.recordNew')}
          </Button>
          {stopButton}
          <Button
            size="xs"
            variant="ghost"
            disabled={direct.busy}
            onClick={() => trackRecordedCall(nextCall)}
          >
            {t('recorder.sameMeeting')}
          </Button>
        </>
      ),
    };
  } else if (active && detecting && detection.callEndedPrompt) {
    view = {
      key: 'ended',
      tone: 'attention',
      content: (
        <>
          <Phone size={14} aria-hidden="true" />
          <b role="alert">{t('recorder.callEnded', { app: detection.callEndedPrompt.app_name })}</b>
          <span className="cx-strip-muted tabular-nums">
            {t('recorder.stillRecordingFor', { title, time: formatElapsed(active.elapsedMs) })}
          </span>
        </>
      ),
      actions: (
        <>
          <Button
            size="xs"
            variant="primary"
            icon={<Square size={13} aria-hidden="true" />}
            disabled={direct.busy || !!busy}
            onClick={() => void stopDetectedCallRecording()}
          >
            {t('recorder.stop')}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => acknowledgeCallEnded()}>
            {t('recorder.keepRecording')}
          </Button>
        </>
      ),
    };
  } else if (active) {
    view = {
      key: active.paused ? 'paused' : 'recording',
      tone: active.paused ? 'attention' : 'live',
      content: (
        <>
          <span className="cx-live-dot" data-paused={active.paused} aria-hidden="true" />
          <b className="tabular-nums" role="status">
            {t(active.paused ? 'recorder.paused' : 'recorder.recording', {
              time: formatElapsed(active.elapsedMs),
            })}
          </b>
          {titleChip}
          <Levels mic={active.mic.peak} output={active.output.peak} paused={active.paused} />
          {direct.receipt?.metadataFailed && (
            <span className="text-warning">{t('recorder.metadataFailed')}</span>
          )}
        </>
      ),
      actions: (
        <>
          <Button
            size="xs"
            variant={active.paused ? 'primary' : 'secondary'}
            icon={
              active.paused ? (
                <Play size={13} aria-hidden="true" />
              ) : (
                <Pause size={13} aria-hidden="true" />
              )
            }
            disabled={!!busy}
            onClick={() => void pauseCapture(!active.paused)}
          >
            {t(active.paused ? 'recorder.resume' : 'recorder.pause')}
          </Button>
          {stopButton}
        </>
      ),
    };
  } else if (status?.processing) {
    view = {
      key: `processing:${status.processing.phase}`,
      tone: 'busy',
      content: (
        <>
          <b role="status">
            {t(`recorder.processing.${processingPhase(status.processing.phase)}`)}
          </b>
          {titleChip}
          <span className="cx-progress" aria-hidden="true">
            <i />
          </span>
          <span className="cx-strip-muted">{t('recorder.background')}</span>
        </>
      ),
    };
  } else if (pendingCall) {
    view = {
      key: `detected:${callKey(pendingCall)}`,
      tone: 'attention',
      content: <DetectedCall call={pendingCall} />,
    };
  } else if (error) {
    view = {
      key: 'error',
      tone: 'live',
      content: (
        <>
          <AlertTriangle size={14} className="text-live" aria-hidden="true" />
          <b role="alert" className="text-live">
            {t('recorder.interrupted')}
          </b>
          <span className="cx-strip-muted truncate">{t('recorder.interruptedHelp')}</span>
        </>
      ),
      actions: (
        <>
          <Button size="xs" variant="primary" onClick={() => void navigate({ to: '/meetings' })}>
            {t('recorder.review')}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            aria-label={t('recorder.dismiss')}
            onClick={dismissCaptureError}
          >
            <X size={13} aria-hidden="true" />
          </Button>
        </>
      ),
    };
  } else {
    view = {
      key: 'idle',
      tone: 'idle',
      content: (
        <>
          <span className="cx-strip-muted">{t('brand.name')}</span>
        </>
      ),
      actions: (
        <span className="cx-strip-muted flex items-center gap-1.5">
          <Mic size={13} aria-hidden="true" />
          {t('recorder.ready')}
        </span>
      ),
    };
  }

  const changed = useChanged(view.key);
  const failureText = failure && failure !== 'status' ? t(`recorder.failure.${failure}`) : null;
  return (
    <header
      className="cx-strip"
      data-tone={view.tone}
      data-changed={changed}
      aria-label={t('recorder.label')}
    >
      <div className="cx-strip-part" key={view.key}>
        {view.content}
      </div>
      {failureText && (
        <span role="alert" className="cx-strip-part text-live">
          {failureText}
        </span>
      )}
      <WindowChrome>
        <div className="cx-strip-part" key={`${view.key}:actions`}>
          {view.actions}
        </div>
      </WindowChrome>
    </header>
  );
}

function processingPhase(phase: string) {
  return ['validation', 'inference', 'stopping'].includes(phase) ? phase : 'running';
}

/** True for one render after the strip changes state, so the sweep plays once. */
function useChanged(key: string) {
  const previous = useRef(key);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (previous.current === key) return;
    previous.current = key;
    setChanged(true);
    const timer = setTimeout(() => setChanged(false), 400);
    return () => clearTimeout(timer);
  }, [key]);
  return changed;
}

function Levels({ mic, output, paused }: { mic: number; output: number; paused: boolean }) {
  const { t } = useTranslation();
  const level = (peak: number) => (paused ? 0.2 : Math.max(0.2, Math.min(1, peak * 3)));
  const bars = [mic, (mic + output) / 2, output];
  return (
    <span className="cx-levels" role="img" aria-label={t('recorder.levels')}>
      {bars.map((peak, i) => (
        <i key={i} style={{ transform: `scaleY(${level(peak)})`, opacity: paused ? 0.5 : 1 }} />
      ))}
    </span>
  );
}

function DetectedCall({ call }: { call: ActiveCall }) {
  const { t } = useTranslation();
  const { busy, error, attempt } = useDirectCapture();
  const [details, setDetails] = useState(false);
  const [title, setTitle] = useState(() => t('meetingDetection.newTitle', { app: call.app_name }));
  const [event, setEvent] = useState<CalendarEvent>();
  const sameAttempt = attempt?.key === callKey(call);
  return (
    <>
      <Phone size={14} aria-hidden="true" />
      <b role="status">{t('recorder.detected', { app: call.app_name })}</b>
      <span className="cx-strip-muted truncate">
        {event ? event.title : t('recorder.detectedHelp')}
      </span>
      <Button
        size="xs"
        variant="primary"
        icon={<Mic size={13} aria-hidden="true" />}
        disabled={busy || !title.trim()}
        onClick={() => void recordDetectedCall(call, title, event)}
      >
        {t(busy ? 'recorder.starting' : 'recorder.record')}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        aria-expanded={details}
        onClick={() => setDetails(!details)}
      >
        {t('recorder.details')}
      </Button>
      <Button size="xs" variant="ghost" disabled={busy} onClick={() => dismissCall(callKey(call))}>
        {t('recorder.ignore')}
      </Button>
      {sameAttempt && error && (
        <span role="alert" className="text-live">
          {t(`meetingDetection.${error}`)}
        </span>
      )}
      {details && (
        <div className="cx-glass absolute left-3 top-[calc(var(--shell-strip-height)+6px)] z-40 w-[420px] rounded-md p-4 shadow-xl">
          <MeetingDetails
            title={title}
            setTitle={setTitle}
            event={event}
            setEvent={setEvent}
            disabled={busy || !!(sameAttempt && attempt.sessionId)}
          />
        </div>
      )}
    </>
  );
}
