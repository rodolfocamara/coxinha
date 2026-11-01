import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import { live, useLiveStatus, type LiveTranscript } from '../capture/live';
import { formatElapsed } from '../capture/recorderParts';

const ACTIVE = new Set(['queued', 'loading', 'running', 'draining', 'paused']);

/**
 * Provisional live transcript of one recording (spec 0097 P3). Never used as
 * confirmed speaker identity or task evidence; the post-call pipeline stays.
 */
export function LiveTranscriptPanel({
  meetingId,
  recording,
}: {
  meetingId: string;
  recording: boolean;
}) {
  const { t } = useTranslation();
  const k = (key: string, values?: Record<string, unknown>) => t(`meetingsHub.live.${key}`, values);
  const [data, setData] = useState<LiveTranscript | null>(null);
  const [busy, setBusy] = useState(false);
  // The strip snapshot changes on every window, so the panel follows it without its own timer.
  const pulse = useLiveStatus(
    (s) => `${s.snapshot?.meeting}:${s.snapshot?.state}:${s.snapshot?.behindMs}`
  );
  const load = useCallback(() => {
    live
      .transcript(meetingId)
      .then(setData)
      .catch(() => {});
  }, [meetingId]);
  useEffect(load, [load, pulse]);
  if (!data) return null;
  const active = ACTIVE.has(data.state);
  if (!active && data.segments.length === 0 && data.state !== 'failed') {
    return recording ? (
      <p className="mh-live-note cx-rise" role="status">
        {t('meetingsHub.liveTranscript')}
      </p>
    ) : null;
  }
  const status =
    data.state === 'failed'
      ? k('failed', { error: data.error ?? '' })
      : active
        ? k(data.state)
        : k('provisional');
  return (
    <section className="mh-live cx-rise" aria-labelledby="live-transcript-heading">
      <header className="mb-2 flex items-center gap-2">
        <h3 id="live-transcript-heading" className="text-[13px] font-semibold">
          {k('title')}
        </h3>
        <span role="status" className="text-xs text-muted-foreground">
          {status}
          {active &&
            data.behindMs > 15_000 &&
            ` · ${k('behind', { time: formatElapsed(data.behindMs) })}`}
        </span>
        <span className="flex-1" />
        {!recording && !active && (
          <Button
            size="xs"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void live
                .resume(meetingId)
                .catch(() => {})
                .finally(() => {
                  setBusy(false);
                  load();
                });
            }}
          >
            {k('resume')}
          </Button>
        )}
      </header>
      <ol className="space-y-1.5">
        {data.segments.map((s) => (
          <li
            key={`${s.track}:${s.startFrame}`}
            className="grid grid-cols-[52px_60px_1fr] gap-2 text-[13px]"
          >
            <span className="tabular-nums text-muted-foreground">{formatElapsed(s.startMs)}</span>
            <span className="text-muted-foreground">{k(s.track === 'Mic' ? 'me' : 'others')}</span>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
