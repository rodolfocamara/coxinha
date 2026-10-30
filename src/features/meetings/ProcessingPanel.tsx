import { Alert, Button, Field, Select, Textarea } from '../../components/ui';
import { voiceCurationErrorText } from './voiceCurationError';
import { SpeakerReview } from './SpeakerReview';
import { useLayoutEffect, useRef, useState } from 'react';
import { useProcessing } from './useProcessing';
import type { ExcerptPlayback } from './useBoundedPlayback';
import { useTranslation } from 'react-i18next';
import { library, type CaptureStatus, type ProcessingConfig } from './library';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
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
  const [configText, setConfigText] = useState('');
  const [configError, setConfigError] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const previousReportJob = useRef<string | null>(null);
  useLayoutEffect(() => {
    const current = data?.report?.job;
    if (!current) return;
    const previous = previousReportJob.current;
    previousReportJob.current = current;
    if (previous && previous !== current) {
      setCorrections({});
      playback?.stop();
    }
  }, [data?.report?.job]);
  const processing = status.processing;
  const peopleView = view === 'people';
  let models: ProcessingConfig['models'] = {};
  try {
    const parsed: unknown = JSON.parse(configText);
    if (parsed && typeof parsed === 'object' && 'models' in parsed) {
      const candidates = parsed.models;
      if (candidates && typeof candidates === 'object' && !Array.isArray(candidates)) {
        models = Object.fromEntries(
          Object.entries(candidates).filter(
            (entry): entry is [string, ProcessingConfig['models'][string]] => {
              const model: unknown = entry[1];
              return (
                !!model &&
                typeof model === 'object' &&
                'path' in model &&
                typeof model.path === 'string' &&
                'sha256' in model &&
                typeof model.sha256 === 'string' &&
                'provenance' in model &&
                typeof model.provenance === 'string'
              );
            }
          )
        );
      }
    }
  } catch {
    /* Backend validation is shown after explicit processing. */
  }
  const report = data?.report;
  const versionSelector = data &&
    data.jobs.filter((item) => item.state === 'succeeded').length > 1 && (
      <Field label={k('version')}>
        <Select
          block
          value={job}
          onChange={(e) => {
            playback?.stop();
            setCorrections({});
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
      aria-label={peopleView ? t('session.tabs.people') : k('title')}
      className={peopleView ? 'space-y-3 pt-1' : 'space-y-4 pt-4'}
    >
      {!peopleView && <h3 className="text-sm font-semibold">{k('title')}</h3>}
      {peopleView && !report && (
        <>
          <p className="text-sm text-muted-foreground">{t('speakers.intro')}</p>
          <Button onClick={onTranscript}>{t('speakers.openTranscript')}</Button>
        </>
      )}
      {!peopleView && (
        <>
          <p className="text-sm text-muted-foreground">{k('notice')}</p>
          <Field label={k('configFile')}>
            <input
              type="file"
              accept="application/json,.json"
              className="block text-ui file:mr-3 file:h-8 file:rounded-sm file:border file:border-border file:bg-card file:px-3 file:text-xs file:text-foreground"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setConfigError(null);
                  try {
                    setConfigText(await file.text());
                  } catch (failure) {
                    setConfigError(message(failure));
                  }
                }
              }}
            />
          </Field>
          {Object.keys(models).length > 0 && (
            <p className="text-sm">
              {k('selectedModels')}: {Object.keys(models).join(', ')}
            </p>
          )}
          <details className="space-y-2">
            <summary className="cursor-pointer text-sm">{k('advancedConfig')}</summary>
            <Field label={k('config')}>
              <Textarea
                className="font-mono"
                rows={7}
                value={configText}
                onChange={(e) => setConfigText(e.target.value)}
                placeholder={k('configPlaceholder')}
              />
            </Field>
            {Object.entries(models).map(([name, model]) => (
              <dl key={name} className="text-xs break-all">
                <dt>{name}</dt>
                <dd>{model.path}</dd>
                <dd>{model.provenance}</dd>
                <dd>SHA-256 {model.sha256}</dd>
              </dl>
            ))}
          </details>
          <Button
            variant="primary"
            disabled={busy || !!status.active || !!processing || !closed || !configText.trim()}
            onClick={() =>
              void act(async () => {
                const config = JSON.parse(configText) as ProcessingConfig;
                onStatus(await library.process(meetingId, config));
              })
            }
          >
            {data?.jobs.some((job) => job.state === 'failed') ? k('retry') : k('process')}
          </Button>
          {(status.active || processing) && (
            <p role="status" className="text-sm">
              {k(processing ? 'running' : 'captureBusy')}
            </p>
          )}
        </>
      )}
      {(error || configError) && (
        <Alert
          tone="error"
          action={
            <Button size="sm" onClick={retry}>
              {t('session.retry')}
            </Button>
          }
        >
          {voiceCurationErrorText(error ?? configError, t)}
        </Alert>
      )}
      {!peopleView &&
        data?.jobs.map((job) => (
          <div key={job.id} className="text-sm">
            <p>
              {k(`state.${job.state}`)} · {k('attempts')} {job.attempts}
            </p>
            {job.error && <Alert tone="error">{job.error}</Alert>}
          </div>
        ))}
      {!peopleView && versionSelector}
      {peopleView && report && processing && <p role="status">{t('speakers.pending')}</p>}
      {peopleView && !report && (
        <p role="status">
          {t(
            `speakers.${error ? 'unavailable' : !data ? 'loading' : processing ? 'pending' : data.jobs.some((j) => j.state === 'failed') ? 'failed' : data.jobs.some((j) => ['queued', 'running'].includes(j.state)) ? 'pending' : 'empty'}`
          )}
        </p>
      )}
      {report && (
        <>
          {!peopleView &&
            report.warnings.map((warning, i) => (
              <Alert key={i} tone="warning">
                {warning ===
                'Experimental anonymous clustering; similarity thresholds are parameters, not calibrated confidence. Overlap and ambiguous speech retain unknown attribution.'
                  ? k('experimentalWarning')
                  : warning ===
                      'Text attribution overlap-v2: same track, union coverage >=70%, abstain on competing/unknown speech; not confidence.'
                    ? k('overlapWarning')
                    : warning}
              </Alert>
            ))}
          {!peopleView && <p className="text-sm text-muted-foreground">{k('unknown')}</p>}
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
          {peopleView && (
            <details className="space-y-3 text-sm text-muted-foreground">
              <summary className="cursor-pointer">{t('speakers.processingDetails')}</summary>
              <p>{k('unknown')}</p>
              <p>{t('speakers.noCalibrationDetails')}</p>
              {versionSelector}
              <Button onClick={onTranscript}>{t('speakers.openTranscript')}</Button>
            </details>
          )}
          {!peopleView && (
            <>
              <h4 className="text-sm font-semibold">{k('transcript')}</h4>
              {report.segments.map((segment) => (
                <div key={segment.id} className="space-y-2 border-b border-border pb-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-auto min-h-8 whitespace-normal text-left"
                    onClick={() => onSeek(segment.track, segment.start_ms / 1000)}
                  >
                    {t(`library.${segment.track}`)} · {formatTime(segment.start_ms)} ·{' '}
                    {segment.speaker
                      ? (report.assignments.find(
                          (a) =>
                            a.speaker === segment.speaker &&
                            a.track === segment.track &&
                            a.state === 'confirmed'
                        )?.name ?? segment.speaker)
                      : k('anonymous')}
                  </Button>
                  <p className="text-base leading-7 whitespace-pre-wrap break-words">
                    {segment.text}
                  </p>
                  {report.corrections?.[segment.id] != null && (
                    <p className="text-sm">
                      {k('humanCorrection')}: {report.corrections?.[segment.id]}
                    </p>
                  )}
                  <Field label={k('correction')}>
                    <Textarea
                      value={corrections[segment.id] ?? report.corrections?.[segment.id] ?? ''}
                      onChange={(e) =>
                        setCorrections((values) => ({ ...values, [segment.id]: e.target.value }))
                      }
                    />
                  </Field>
                  <Button
                    size="sm"
                    disabled={busy || corrections[segment.id] === undefined}
                    onClick={() =>
                      void act(() =>
                        library.editSegment(
                          meetingId,
                          `${report.job}:${segment.id}`,
                          corrections[segment.id]
                        )
                      )
                    }
                  >
                    {k('saveCorrection')}
                  </Button>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
function formatTime(ms: number) {
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
}

export function ProcessingPanel(props: Parameters<typeof ProcessingPanelForMeeting>[0]) {
  return <ProcessingPanelForMeeting key={props.meetingId} {...props} />;
}
