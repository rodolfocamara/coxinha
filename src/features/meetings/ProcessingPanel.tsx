import { Alert, Button, Field, Select } from '../../components/ui';
import { voiceCurationErrorText } from './voiceCurationError';
import { SpeakerReview } from './SpeakerReview';
import { useLayoutEffect, useRef } from 'react';
import { FileText, RotateCw } from 'lucide-react';
import { useProcessing } from './useProcessing';
import type { ExcerptPlayback } from './useBoundedPlayback';
import { useTranslation } from 'react-i18next';
import type { CaptureStatus } from './library';
import { ProcessingControls } from './ProcessingControls';
import { TranscriptReader } from './TranscriptReader';

function ProcessingPanelForMeeting({
  meetingId,
  closed,
  status,
  onStatus,
  onSeek,
  view = 'legacy',
  playback,
  onTranscript,
}: {
  meetingId: string;
  closed: boolean;
  status: CaptureStatus;
  onStatus: (status: CaptureStatus) => void;
  onSeek: (track: string, seconds: number, end?: number) => void;
  view?: 'legacy' | 'transcript' | 'people';
  playback?: ExcerptPlayback;
  onTranscript?: () => void;
}) {
  const { t } = useTranslation();
  const k = (name: string) => t(`library.processing.${name}`);
  const { job, setJob, data, busy, error, act, retry } = useProcessing(meetingId, status);
  const previousReportJob = useRef<string | null>(null);
  useLayoutEffect(() => {
    const current = data?.report?.job;
    if (!current) return;
    const previous = previousReportJob.current;
    previousReportJob.current = current;
    if (previous && previous !== current) playback?.stop();
  }, [data?.report?.job]);
  const processing = status.processing;
  const peopleView = view === 'people';
  const report = data?.report;
  const versionSelector = data &&
    data.jobs.filter((item) => item.state === 'succeeded').length > 1 && (
      <Field label={k('version')}>
        <Select
          block
          value={job}
          onChange={(e) => {
            playback?.stop();
            setJob(e.target.value);
          }}
        >
          <option value="">{k('latest')}</option>
          {data.jobs
            .filter((item) => item.state === 'succeeded')
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
              </option>
            ))}
        </Select>
      </Field>
    );
  return (
    <section
      aria-label={peopleView ? t('session.tabs.people') : k('reader.label')}
      className={peopleView ? 'space-y-3 pt-1' : 'space-y-4 pt-4'}
    >
      {peopleView && !report && (
        <>
          <p className="text-sm text-muted-foreground">{t('speakers.intro')}</p>
          <Button onClick={onTranscript} icon={<FileText size={14} aria-hidden="true" />}>
            {t('speakers.openTranscript')}
          </Button>
        </>
      )}
      {!peopleView && (status.active || processing) && (
        <p role="status" className="text-sm text-muted-foreground">
          {k(processing ? 'running' : 'captureBusy')}
        </p>
      )}
      {error && (
        <Alert
          tone="error"
          action={
            <Button size="sm" onClick={retry} icon={<RotateCw size={14} aria-hidden="true" />}>
              {t('session.retry')}
            </Button>
          }
        >
          {voiceCurationErrorText(error, t)}
        </Alert>
      )}
      {peopleView && report && processing && <p role="status">{t('speakers.pending')}</p>}
      {peopleView && !report && (
        <p role="status">
          {t(
            `speakers.${error ? 'unavailable' : !data ? 'loading' : processing ? 'pending' : data.jobs.some((j) => j.state === 'failed') ? 'failed' : data.jobs.some((j) => ['queued', 'running'].includes(j.state)) ? 'pending' : 'empty'}`
          )}
        </p>
      )}
      {report && (
        <div hidden={view === 'transcript'}>
          <SpeakerReview
            key={report.job}
            meetingId={meetingId}
            data={data}
            report={report}
            disabled={busy || !!status.active || !!processing}
            onSeek={onSeek}
            act={act}
            playback={playback}
          />
        </div>
      )}
      {peopleView && report && (
        <details className="space-y-3 text-sm text-muted-foreground">
          <summary className="cursor-pointer">{t('speakers.processingDetails')}</summary>
          <p>{k('unknown')}</p>
          <p>{t('speakers.noCalibrationDetails')}</p>
          {versionSelector}
          <Button onClick={onTranscript} icon={<FileText size={14} aria-hidden="true" />}>
            {t('speakers.openTranscript')}
          </Button>
        </details>
      )}
      {!peopleView && report && (
        <TranscriptReader
          key={report.job}
          meetingId={meetingId}
          report={report}
          busy={busy}
          act={act}
          onSeek={onSeek}
          versionSelector={versionSelector}
        />
      )}
      {!peopleView && (
        <ProcessingControls
          meetingId={meetingId}
          closed={closed}
          status={status}
          onStatus={onStatus}
          busy={busy}
          act={act}
          data={data}
        />
      )}
    </section>
  );
}

export function ProcessingPanel(props: Parameters<typeof ProcessingPanelForMeeting>[0]) {
  return <ProcessingPanelForMeeting key={props.meetingId} {...props} />;
}
