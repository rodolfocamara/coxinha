import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Field, Textarea } from '../../components/ui';
import {
  library,
  type CaptureStatus,
  type ProcessingConfig,
  type ProcessingDetail,
} from './library';
import { rememberProcessingConfig } from './processingConfigMemory';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const EXPERIMENTAL =
  'Experimental anonymous clustering; similarity thresholds are parameters, not calibrated confidence. Overlap and ambiguous speech retain unknown attribution.';
const OVERLAP =
  'Text attribution overlap-v2: same track, union coverage >=70%, abstain on competing/unknown speech; not confidence.';

function modelsOf(configText: string): ProcessingConfig['models'] {
  try {
    const parsed: unknown = JSON.parse(configText);
    if (!parsed || typeof parsed !== 'object' || !('models' in parsed)) return {};
    const candidates = parsed.models;
    if (!candidates || typeof candidates !== 'object' || Array.isArray(candidates)) return {};
    return Object.fromEntries(
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
  } catch {
    // Backend validation is shown after explicit processing.
    return {};
  }
}

/**
 * Everything about producing a transcript (spec 0109): explicit model config,
 * process/retry, job states and engine warnings. Collapsed once there is
 * something to read; open while the meeting has no transcript yet.
 */
export function ProcessingControls({
  meetingId,
  closed,
  status,
  onStatus,
  busy,
  act,
  data,
}: {
  meetingId: string;
  closed: boolean;
  status: CaptureStatus;
  onStatus: (status: CaptureStatus) => void;
  busy: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
  data: ProcessingDetail | null | undefined;
}) {
  const { t } = useTranslation();
  const k = (name: string) => t(`library.processing.${name}`);
  const [configText, setConfigText] = useState('');
  const [configError, setConfigError] = useState<string | null>(null);
  const models = modelsOf(configText);
  const report = data?.report;
  const processing = status.processing;
  return (
    <details className="space-y-3 border-t border-border pt-3" open={!report}>
      <summary className="cursor-pointer text-sm font-semibold">{k('reader.processing')}</summary>
      <p className="text-sm text-muted-foreground">{k('notice')}</p>
      <Field label={k('configFile')}>
        <input
          data-processing-config
          type="file"
          accept="application/json,.json"
          className="block text-ui file:mr-3 file:h-8 file:rounded-sm file:border file:border-border file:bg-card file:px-3 file:text-xs file:text-foreground"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setConfigError(null);
            try {
              setConfigText(await file.text());
            } catch (failure) {
              setConfigError(message(failure));
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
      {configError && <Alert tone="error">{configError}</Alert>}
      <Button
        variant="primary"
        disabled={busy || !!status.active || !!processing || !closed || !configText.trim()}
        onClick={() =>
          void act(async () => {
            const config = JSON.parse(configText) as ProcessingConfig;
            onStatus(await library.process(meetingId, config));
            rememberProcessingConfig(config);
          })
        }
      >
        {data?.jobs.some((job) => job.state === 'failed') ? k('retry') : k('process')}
      </Button>
      {data?.jobs.map((job) => (
        <div key={job.id} className="text-sm">
          <p>
            {k(`state.${job.state}`)} · {k('attempts')} {job.attempts}
          </p>
          {job.error && <Alert tone="error">{job.error}</Alert>}
        </div>
      ))}
      {report?.warnings.map((warning, i) => (
        <Alert key={i} tone="warning">
          {warning === EXPERIMENTAL
            ? k('experimentalWarning')
            : warning === OVERLAP
              ? k('overlapWarning')
              : warning}
        </Alert>
      ))}
      {report && <p className="text-sm text-muted-foreground">{k('unknown')}</p>}
    </details>
  );
}
