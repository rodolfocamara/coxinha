import { Mic, PhoneOff, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import { dismissEndedWithCall } from './autoRecord';
import { quickCaptureTitle } from '../../components/Shell/NavRail';
import { toggleCapture } from './captureActions';
import { useCaptureStore } from './captureStore';
import { useLiveStatus } from './live';
import { processingPhase } from './recorderParts';

const DRAINING = ['loading', 'running', 'draining'];

/**
 * Spec 0121 P3: processing and the previous meeting's live transcript are a
 * secondary line, never a state that hides the record button.
 */
export function useBackgroundWork() {
  const { t } = useTranslation();
  const processing = useCaptureStore((s) => s.status?.processing ?? null);
  const activeId = useCaptureStore((s) => s.status?.active?.meetingId ?? null);
  const snapshot = useLiveStatus((s) => s.snapshot);
  if (processing) return t(`recorder.processing.${processingPhase(processing.phase)}`);
  if (snapshot?.meeting && snapshot.meeting !== activeId && DRAINING.includes(snapshot.state))
    return t('recorder.previousTranscript');
  return null;
}

export function BackgroundLine({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <span className="cx-strip-muted flex items-center gap-1.5" role="status">
      <span className="cx-progress" aria-hidden="true">
        <i />
      </span>
      {text}
      <span>· {t('recorder.background')}</span>
    </span>
  );
}

export function RecordButton() {
  const { t } = useTranslation();
  const busy = useCaptureStore((s) => !!s.busy);
  return (
    <Button
      size="xs"
      variant="primary"
      icon={<Mic size={13} aria-hidden="true" />}
      disabled={busy}
      title={t('shell.record.startHint')}
      onClick={() => void toggleCapture(quickCaptureTitle(t('shell.record.quickTitle')))}
    >
      {t('recorder.record')}
    </Button>
  );
}

/** Spec 0118 P3: the capture stopped on its own with its call. */
export function EndedWithCall({ app, onOpen }: { app: string; onOpen?: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <PhoneOff size={14} aria-hidden="true" />
      <b role="status">{t('recorder.endedWithCall')}</b>
      <span className="cx-strip-muted">{t('recorder.endedWithCallBody', { app })}</span>
      {onOpen && (
        <Button size="xs" variant="ghost" onClick={onOpen}>
          {t('recorder.openMeeting')}
        </Button>
      )}
      <Button
        size="xs"
        variant="ghost"
        iconOnly
        aria-label={t('recorder.dismiss')}
        onClick={dismissEndedWithCall}
      >
        <X size={13} aria-hidden="true" />
      </Button>
    </>
  );
}
