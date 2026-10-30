import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  acknowledgeCallEnded,
  callKey,
  dismissCall,
  trackRecordedCall,
  useMeetingDetection,
} from './meetingDetection';
import {
  recordDetectedCall,
  stopDetectedCallRecording,
  switchToDetectedCall,
  useDirectCapture,
  useRecordingStatusHost,
} from './directCapture';
import { MeetingDetails } from './MeetingDetails';
import type { ActiveCall } from '../../lib/bindings';
import type { CalendarEvent } from '../agenda/calendar';

export function MeetingReminder() {
  const { t } = useTranslation();
  const { enabled, status, failed, recording, dismissed, recordedCallKey, callEndedPrompt } =
    useMeetingDetection();
  const { receipt, busy } = useDirectCapture();
  const activeMounted = useRecordingStatusHost((s) => s.activeMounted);

  if (enabled && !failed && !status?.unavailable && recording) {
    const nextCall = recordedCallKey
      ? status?.calls.find((c) => callKey(c) !== recordedCallKey && !dismissed.includes(callKey(c)))
      : undefined;
    if (nextCall) {
      return <NextCallReminder key={callKey(nextCall)} call={nextCall} />;
    }
    if (callEndedPrompt) {
      return <EndedCallReminder call={callEndedPrompt} />;
    }
  }

  if (receipt && !activeMounted)
    return (
      <section
        aria-label={t('meetingDetection.title')}
        className="shrink-0 flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2 text-sm"
      >
        <p role={receipt.metadataFailed ? 'alert' : 'status'}>
          {t(
            receipt.metadataFailed ? 'meetingDetection.metadataFailed' : 'meetingDetection.started',
            { title: receipt.title }
          )}
        </p>
        <Link
          className="underline"
          to="/sessions/$sessionId"
          params={{ sessionId: receipt.sessionId }}
        >
          {t('meetingDetection.viewSession')}
        </Link>
        <button type="button" onClick={() => useDirectCapture.setState({ receipt: null })}>
          {t('meetingDetection.closeNotice')}
        </button>
      </section>
    );
  const call = status?.calls.find((c) => !dismissed.includes(callKey(c)));
  if (!enabled || failed || status?.unavailable || (recording && !busy) || !call) return null;
  return <Reminder key={callKey(call)} call={call} />;
}

function EndedCallReminder({ call }: { call: ActiveCall }) {
  const { t } = useTranslation();
  const { busy, error } = useDirectCapture();
  return (
    <section
      aria-label={t('meetingDetection.endedTitle')}
      className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm space-y-2"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p role="alert" className="flex-1 min-w-0 font-medium text-foreground">
          {t('meetingDetection.endedPrompt', { app: call.app_name })}
        </p>
        <button
          type="button"
          className="rounded bg-destructive text-destructive-foreground px-3 py-1 font-medium disabled:opacity-50"
          disabled={busy}
          onClick={() => void stopDetectedCallRecording()}
        >
          {t('meetingDetection.stopAndSaveNow')}
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 hover:bg-secondary disabled:opacity-50"
          disabled={busy}
          onClick={() => acknowledgeCallEnded()}
        >
          {t('meetingDetection.keepRecording')}
        </button>
      </div>
      {error && <p role="alert">{t(`meetingDetection.${error}`)}</p>}
    </section>
  );
}

function NextCallReminder({ call }: { call: ActiveCall }) {
  const { t } = useTranslation();
  const { busy, error } = useDirectCapture();
  const [title] = useState(() => t('meetingDetection.newTitle', { app: call.app_name }));
  return (
    <section
      aria-label={t('meetingDetection.endedTitle')}
      className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm space-y-2"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p role="alert" className="flex-1 min-w-0 font-medium text-foreground">
          {t('meetingDetection.nextCallDetected', { app: call.app_name })}
        </p>
        <button
          type="button"
          className="rounded bg-primary text-primary-foreground px-3 py-1 font-medium disabled:opacity-50"
          disabled={busy || !title.trim()}
          onClick={() => void switchToDetectedCall(call, title)}
        >
          {t(busy ? 'meetingDetection.switchingMeeting' : 'meetingDetection.startNewMeeting')}
        </button>
        <button
          type="button"
          className="rounded border border-border bg-background px-2.5 py-1 hover:bg-secondary disabled:opacity-50"
          disabled={busy}
          onClick={() => void stopDetectedCallRecording()}
        >
          {t('meetingDetection.stopAndSaveNow')}
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 hover:bg-secondary disabled:opacity-50"
          disabled={busy}
          onClick={() => trackRecordedCall(call)}
        >
          {t('meetingDetection.sameMeeting')}
        </button>
      </div>
      {error && <p role="alert">{t(`meetingDetection.${error}`)}</p>}
    </section>
  );
}

function Reminder({ call }: { call: ActiveCall }) {
  const { t } = useTranslation();
  const { busy, error, attempt } = useDirectCapture();
  const [details, setDetails] = useState(false);
  const [title, setTitle] = useState(() => t('meetingDetection.newTitle', { app: call.app_name }));
  const [event, setEvent] = useState<CalendarEvent>();
  const sameAttempt = attempt?.key === callKey(call);
  return (
    <section
      aria-label={t('meetingDetection.title')}
      className="shrink-0 border-b border-border bg-card px-4 py-3 text-sm space-y-2 max-h-[50vh] overflow-auto"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p role="status" className="flex-1 min-w-0">
          {t('meetingDetection.detected', { app: call.app_name })}
        </p>
        <button
          type="button"
          className="rounded bg-primary text-primary-foreground px-3 py-1 disabled:opacity-50"
          disabled={busy || !title.trim()}
          onClick={() => void recordDetectedCall(call, title, event)}
        >
          {t(busy ? 'meetingDetection.starting' : 'meetingDetection.recordNow')}
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 hover:bg-secondary"
          disabled={busy}
          onClick={() => dismissCall(callKey(call))}
        >
          {t('meetingDetection.dismiss')}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
        <span>{t('meetingDetection.defaultsHelp')}</span>
        <button
          type="button"
          className="underline"
          aria-expanded={details}
          onClick={() => setDetails(!details)}
        >
          {t('meetingDetection.details')}
        </button>
      </div>
      {details && (
        <MeetingDetails
          title={title}
          setTitle={setTitle}
          event={event}
          setEvent={setEvent}
          disabled={busy || !!(sameAttempt && attempt.sessionId)}
        />
      )}
      {sameAttempt && error && <p role="alert">{t(`meetingDetection.${error}`)}</p>}
    </section>
  );
}
