import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { library, type CaptureStatus } from '../../features/meetings/library';
import { useDirectCapture, useRecordingStatusHost } from '../../features/detection/directCapture';
import { sessionCaptureCache } from '../../features/sessions/sessionCapture';
import { sessionListCache } from '../../features/sessions/sessions';
import { Button, ButtonLink } from '../ui';

export { useRecordingStatusHost };

export interface RecordingStatusProps {
  variant?: 'sidebar' | 'bar';
}

/** Never starts capture. Polls sequentially and leaves recovery accessible. */
export function RecordingStatus({ variant = 'bar' }: RecordingStatusProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pausing, setPausing] = useState(false);
  const action = useRef(false);
  const revision = useRef(0);
  const mounted = useRef(false);
  const receipt = useDirectCapture((s) => s.receipt);
  const sessions = sessionListCache((s) => s.data);
  const bySession = sessionCaptureCache((s) => s.bySession);

  useEffect(() => {
    if (!library.available()) return;
    mounted.current = true;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let active = false;
      const current = revision.current;
      try {
        if (action.current) return;
        const next = await library.status();
        active = !!next.active || !!next.processing;
        if (live && current === revision.current) {
          setStatus(next);
          setFailed(!!next.error);
        }
      } catch {
        if (live && current === revision.current) setFailed(true);
      } finally {
        if (live) timer = setTimeout(() => void poll(), active ? 500 : 2000);
      }
    };
    void poll();
    return () => {
      live = false;
      mounted.current = false;
      clearTimeout(timer);
    };
  }, []);

  const hasActive = !!status?.active;
  useEffect(() => {
    useRecordingStatusHost.setState({ activeMounted: hasActive });
    return () => {
      useRecordingStatusHost.setState({ activeMounted: false });
    };
  }, [hasActive]);

  async function stop() {
    if (action.current) return;
    action.current = true;
    revision.current += 1;
    setStopping(true);
    try {
      const next = await library.stop();
      if (mounted.current) {
        setStatus(next);
        setFailed(!!next.error);
      }
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      action.current = false;
      if (mounted.current) setStopping(false);
    }
  }

  async function togglePause() {
    if (action.current || !status?.active || typeof library.pause !== 'function') return;
    action.current = true;
    revision.current += 1;
    setPausing(true);
    try {
      const next = await library.pause(!status.active.paused);
      if (mounted.current) {
        setStatus(next);
        setFailed(!!next.error);
      }
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      action.current = false;
      if (mounted.current) setPausing(false);
    }
  }

  if (!status?.active && !status?.processing && !failed) return null;

  const elapsed = Math.floor((status?.active?.elapsedMs ?? 0) / 1000);
  const timeFormatted = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const processingLabel =
    status?.processing?.phase === 'validation'
      ? 'desktopRecording.validating'
      : status?.processing?.phase === 'inference'
        ? 'desktopRecording.inference'
        : status?.processing?.phase === 'stopping'
          ? 'desktopRecording.stoppingProcessing'
          : 'desktopRecording.processing';

  const activeMeetingId = status?.active?.meetingId;
  const matchedSession = activeMeetingId
    ? (sessions ?? []).find(
        (s) =>
          s.meeting_id === activeMeetingId ||
          s.recording?.id === activeMeetingId ||
          bySession.get(s.id) === activeMeetingId
      )
    : undefined;
  const activeSessionId = receipt?.sessionId ?? matchedSession?.id;
  const activeTitle = receipt?.title ?? matchedSession?.title;
  const canPause = typeof library.pause === 'function';
  const micPeak = Math.max(0.2, Math.min(1, status?.active?.mic?.peak ?? 0.35));
  const outPeak = Math.max(0.2, Math.min(1, status?.active?.output?.peak ?? 0.55));
  const midPeak = Math.max(0.25, Math.min(1, (micPeak + outPeak) / 2));

  if (variant === 'sidebar') {
    return (
      <section
        aria-label={t('desktopRecording.label')}
        className="mx-3 mt-2 mb-1 rounded-md border border-border bg-card p-2.5 text-xs space-y-2"
      >
        {status?.active && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                  {!status.active.paused && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      status.active.paused ? 'bg-[oklch(var(--warning))]' : 'bg-destructive'
                    }`}
                  />
                </span>
                <span
                  role="status"
                  className="font-mono font-semibold tabular-nums text-foreground"
                >
                  {t(status.active.paused ? 'desktopRecording.paused' : 'desktopRecording.active', {
                    time: timeFormatted,
                  })}
                </span>
              </div>
              <span className="flex items-end gap-0.5 h-3 shrink-0" aria-hidden="true">
                <span
                  className={`w-0.5 rounded-full transition-all ${
                    status.active.paused ? 'bg-muted-foreground/40' : 'bg-primary'
                  }`}
                  style={{ height: `${Math.round(micPeak * 12)}px` }}
                />
                <span
                  className={`w-0.5 rounded-full transition-all ${
                    status.active.paused ? 'bg-muted-foreground/40' : 'bg-primary'
                  }`}
                  style={{ height: `${Math.round(midPeak * 12)}px` }}
                />
                <span
                  className={`w-0.5 rounded-full transition-all ${
                    status.active.paused ? 'bg-muted-foreground/40' : 'bg-primary'
                  }`}
                  style={{ height: `${Math.round(outPeak * 12)}px` }}
                />
              </span>
            </div>

            {activeTitle && (
              <div className="flex items-center justify-between gap-2 min-w-0">
                {activeSessionId ? (
                  <Link
                    to="/sessions/$sessionId"
                    params={{ sessionId: activeSessionId }}
                    className="truncate font-medium text-foreground hover:underline"
                    title={activeTitle}
                  >
                    {activeTitle}
                  </Link>
                ) : (
                  <span className="truncate font-medium text-foreground" title={activeTitle}>
                    {activeTitle}
                  </span>
                )}
                {receipt && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-1.5"
                    onClick={() => useDirectCapture.setState({ receipt: null })}
                  >
                    {t('meetingDetection.closeNotice')}
                  </Button>
                )}
              </div>
            )}

            {receipt?.metadataFailed && (
              <p role="alert" className="text-xs text-destructive">
                {t('meetingDetection.metadataFailed')}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {canPause && (
                <Button size="sm" disabled={stopping || pausing} onClick={() => void togglePause()}>
                  {t(status.active.paused ? 'library.resume' : 'library.pause')}
                </Button>
              )}
              <Button
                size="sm"
                variant="primary"
                className="flex-1"
                disabled={stopping || pausing}
                onClick={() => void stop()}
              >
                {t(stopping ? 'desktopRecording.stopping' : 'library.stop')}
              </Button>
            </div>
          </div>
        )}

        {status?.processing && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full bg-primary animate-pulse shrink-0"
                aria-hidden="true"
              />
              <span role="status" className="font-medium text-foreground">
                {t(processingLabel)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('desktopRecording.backgroundProcessing')}
            </p>
          </div>
        )}

        {failed && (
          <p role="alert" className="text-xs text-destructive">
            {t('desktopRecording.failed')}
          </p>
        )}

        <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-border">
          <ButtonLink to="/meetings" variant="ghost" size="sm" className="-ml-1.5 h-7 px-1.5">
            {t('desktopRecording.open')}
          </ButtonLink>
          {activeSessionId && (
            <ButtonLink
              to="/sessions/$sessionId"
              params={{ sessionId: activeSessionId }}
              variant="ghost"
              size="sm"
              className="-mr-1.5 h-7 px-1.5"
            >
              {t('meetingDetection.viewSession')}
            </ButtonLink>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label={t('desktopRecording.label')}
      className="shrink-0 flex flex-wrap items-center gap-3 border-b border-border bg-secondary/80 px-4 py-1.5 text-xs"
    >
      {status?.active && (
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-2.5 py-0.5 font-mono font-medium tabular-nums">
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
            {!status.active.paused && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
            )}
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                status.active.paused ? 'bg-[oklch(var(--warning))]' : 'bg-destructive'
              }`}
            />
          </span>
          <span role="status">
            {t(status.active.paused ? 'desktopRecording.paused' : 'desktopRecording.active', {
              time: timeFormatted,
            })}
          </span>
        </span>
      )}
      {activeTitle && (
        <span className="truncate font-medium text-foreground max-w-xs" title={activeTitle}>
          {activeTitle}
        </span>
      )}
      {status?.processing && (
        <>
          <span role="status" className="font-medium">
            {t(processingLabel)}
          </span>
          <span className="text-muted-foreground">
            {t('desktopRecording.backgroundProcessing')}
          </span>
        </>
      )}
      {failed && (
        <span role="alert" className="text-destructive">
          {t('desktopRecording.failed')}
        </span>
      )}
      {receipt?.metadataFailed && (
        <span role="alert" className="text-destructive">
          {t('meetingDetection.metadataFailed')}
        </span>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {activeSessionId && (
          <ButtonLink
            to="/sessions/$sessionId"
            params={{ sessionId: activeSessionId }}
            variant="ghost"
            size="sm"
          >
            {t('meetingDetection.viewSession')}
          </ButtonLink>
        )}
        <ButtonLink to="/meetings" variant="ghost" size="sm">
          {t('desktopRecording.open')}
        </ButtonLink>
        {status?.active && canPause && (
          <Button size="sm" disabled={stopping || pausing} onClick={() => void togglePause()}>
            {t(status.active.paused ? 'library.resume' : 'library.pause')}
          </Button>
        )}
        {status?.active && (
          <Button
            size="sm"
            variant="primary"
            disabled={stopping || pausing}
            onClick={() => void stop()}
          >
            {t(stopping ? 'desktopRecording.stopping' : 'library.stop')}
          </Button>
        )}
      </div>
    </section>
  );
}
