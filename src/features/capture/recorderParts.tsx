import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Mic, Phone, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import type { ActiveCall } from '../../lib/bindings';
import { callKey, dismissCall } from '../detection/meetingDetection';
import { recordDetectedCall, useDirectCapture } from '../detection/directCapture';
import { MeetingDetails } from '../detection/MeetingDetails';
import type { CalendarEvent } from '../agenda/calendar';
import { keepAutoRecording } from './autoRecord';
import { live, refreshLiveStatus, useLiveStatus } from './live';
import { stopCapture } from './captureActions';

export function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export type Tone = 'idle' | 'live' | 'attention' | 'busy';
export type View = { key: string; tone: Tone; content: ReactNode; actions?: ReactNode };

export function processingPhase(phase: string) {
  return ['validation', 'inference', 'stopping'].includes(phase) ? phase : 'running';
}

/** True for one render after the strip changes state, so the sweep plays once. */
export function useChanged(key: string) {
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

export function Levels({ mic, output, paused }: { mic: number; output: number; paused: boolean }) {
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

export function DetectedCall({ call }: { call: ActiveCall }) {
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

/** Spec 0097: the bound call ended; the backend stops when this reaches zero. */
export function AutoStopNotice({
  app,
  stopAt,
  busy,
}: {
  app: string;
  stopAt: number;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <Phone size={14} aria-hidden="true" />
      <b role="alert">{t('recorder.callEnded', { app })}</b>
      <span className="cx-strip-muted tabular-nums">
        {t('recorder.autoStopIn', { time: formatElapsed(stopAt - now + 999) })}
      </span>
      <Button
        size="xs"
        variant="primary"
        icon={<Square size={13} aria-hidden="true" />}
        disabled={busy}
        onClick={() => void stopCapture()}
      >
        {t('recorder.stopNow')}
      </Button>
      <Button size="xs" variant="ghost" onClick={() => void keepAutoRecording()}>
        {t('recorder.keepRecording')}
      </Button>
    </>
  );
}

/** "Pausar transcrição": independent of the capture (spec 0097 P3). */
export function LiveToggle({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation();
  const state = useLiveStatus((s) => (s.snapshot?.meeting === meetingId ? s.snapshot.state : null));
  if (state !== 'running' && state !== 'paused' && state !== 'loading') return null;
  const paused = state === 'paused';
  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={() =>
        void live
          .pause(!paused)
          .then(refreshLiveStatus)
          .catch(() => {})
      }
    >
      {t(paused ? 'recorder.liveResume' : 'recorder.livePause')}
    </Button>
  );
}
