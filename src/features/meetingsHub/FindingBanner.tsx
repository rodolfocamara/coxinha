import { useTranslation } from 'react-i18next';
import { AudioLines } from 'lucide-react';
import { Button } from '../../components/ui';
import type { LibraryMeeting, ProcessingDetail } from '../meetings/library';
import { durationLabel } from './format';

export type Finding =
  | { kind: 'recover' }
  | { kind: 'processing' }
  | { kind: 'failed'; error: string | null }
  | { kind: 'speakers'; count: number }
  | { kind: 'untranscribed'; durationMs: number | null }
  | { kind: 'planned'; until: string | null; people: number };

/** The one sentence a meeting needs most, in priority order. */
export function findingFor({
  live,
  meetingId,
  captureState,
  processingHere,
  processing,
  unconfirmed,
  durationMs,
  planned,
}: {
  live: boolean;
  meetingId: string | null;
  captureState: LibraryMeeting['captureState'] | undefined;
  processingHere: boolean;
  processing: ProcessingDetail | null;
  unconfirmed: number;
  durationMs: number | null;
  planned: { until: string | null; people: number } | null;
}): Finding | null {
  if (live) return null;
  if (!meetingId) return planned ? { kind: 'planned', ...planned } : null;
  if (captureState === 'recording' || captureState === 'interrupted') return { kind: 'recover' };
  const latest = processing?.jobs[0];
  if (processingHere || (latest && ['queued', 'running'].includes(latest.state)))
    return { kind: 'processing' };
  if (latest?.state === 'failed' && !processing?.report)
    return { kind: 'failed', error: latest.error };
  if (processing?.report && unconfirmed > 0) return { kind: 'speakers', count: unconfirmed };
  if (captureState === 'finished' && processing && !processing.jobs.length)
    return { kind: 'untranscribed', durationMs };
  return null;
}

export function FindingBanner({
  finding,
  busy,
  onRecover,
  onTranscribe,
  onReview,
}: {
  finding: Finding | null;
  busy: boolean;
  onRecover: () => void;
  onTranscribe: () => void;
  onReview: () => void;
}) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.finding.${key}`, options);
  if (!finding) return null;
  const pill = (tone: string, text: string) => (
    <span className="mh-pill" data-tone={tone}>
      {text}
    </span>
  );
  let body;
  switch (finding.kind) {
    case 'recover':
      body = (
        <>
          {pill('live', k('recoverPill'))}
          <span>{k('recover')}</span>
          <span className="flex-1" />
          <Button size="xs" variant="primary" disabled={busy} onClick={onRecover}>
            {k('recoverAction')}
          </Button>
        </>
      );
      break;
    case 'processing':
      body = (
        <>
          {pill('info', k('processingPill'))}
          <span>{k('processing')}</span>
        </>
      );
      break;
    case 'failed':
      body = (
        <>
          {pill('live', k('failedPill'))}
          <span className="min-w-0">
            {finding.error ? k('failedWith', { error: finding.error }) : k('failed')}
          </span>
          <span className="flex-1" />
          <Button size="xs" variant="primary" disabled={busy} onClick={onTranscribe}>
            {k('retry')}
          </Button>
        </>
      );
      break;
    case 'speakers':
      body = (
        <>
          {pill('warning', k('speakersPill'))}
          <span>{k('speakers', { count: finding.count })}</span>
          <span className="flex-1" />
          <Button size="xs" onClick={onReview}>
            {k('review')}
          </Button>
        </>
      );
      break;
    case 'untranscribed':
      body = (
        <>
          {pill('neutral', k('untranscribedPill'))}
          <span>
            {finding.durationMs
              ? k('untranscribedFor', { duration: durationLabel(finding.durationMs, t) })
              : k('untranscribed')}
          </span>
          <span className="flex-1" />
          <Button
            size="xs"
            variant="primary"
            icon={<AudioLines size={13} aria-hidden="true" />}
            disabled={busy}
            onClick={onTranscribe}
          >
            {k('transcribe')}
          </Button>
        </>
      );
      break;
    case 'planned':
      body = (
        <>
          {finding.until && pill('info', finding.until)}
          <span>
            {finding.people ? k('plannedPeople', { count: finding.people }) : k('planned')}
          </span>
        </>
      );
      break;
  }
  return (
    <div className="mh-finding cx-glass" role="status" data-kind={finding.kind}>
      {body}
    </div>
  );
}
