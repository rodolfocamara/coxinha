import { FileAudio, Pause, Play, RefreshCw, Square } from 'lucide-react';
import { Alert, Button, Field, Input, Select } from '../../components/ui';
import { RecordingInformation } from './RecordingInformation';
import { useTranslation } from 'react-i18next';
import {
  meterDiagnostic,
  validSources,
  type CaptureStatus,
  type Meter,
  type Source,
} from './library';

interface Props {
  showActions?: boolean;
  devicesLoading?: boolean;
  devicesFailed?: boolean;
  onRefreshDevices?: () => void;
  onSystemDefaults?: () => void;
  allowImport?: boolean;
  fixedTitle?: boolean;
  desktop: boolean;
  sources: Source[];
  status: CaptureStatus;
  busy: boolean;
  title: string;
  mic: string;
  output: string;
  setTitle: (value: string) => void;
  setMic: (value: string) => void;
  setOutput: (value: string) => void;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onImport: () => void;
}

/** Controlled presentation only. LibraryView retains all capture state and IPC. */
export function CaptureSection({
  showActions = true,
  devicesLoading = false,
  devicesFailed = false,
  onRefreshDevices,
  onSystemDefaults,
  allowImport = true,
  fixedTitle = false,
  desktop,
  sources,
  status,
  busy,
  title,
  mic,
  output,
  setTitle,
  setMic,
  setOutput,
  onStart,
  onPause,
  onStop,
  onImport,
}: Props) {
  const { t } = useTranslation();
  const key = (name: string) => t(`library.${name}`);
  const active = status.active;
  return (
    <section
      aria-label={key('capture')}
      className={
        fixedTitle
          ? 'border-t border-border py-3 space-y-3'
          : 'border-y border-border py-4 space-y-4'
      }
    >
      {!fixedTitle && <h2 className="text-sm font-semibold">{key('capture')}</h2>}
      {!fixedTitle && (
        <Field label={key('meetingTitle')}>
          <Input
            value={title}
            disabled={!!active || busy || devicesLoading || !desktop}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {(['mic', 'output'] as const).map((kind) => (
          <Field key={kind} label={key(kind)}>
            <Select
              block
              value={kind === 'mic' ? mic : output}
              disabled={!!active || busy || devicesLoading || !desktop}
              onChange={(e) =>
                kind === 'mic' ? setMic(e.target.value) : setOutput(e.target.value)
              }
            >
              <option value="">{key('chooseSource')}</option>
              {sources
                .filter((s) => s.monitor === (kind === 'output'))
                .map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.description || s.name}
                    {s.is_default ? ` · ${key('systemDefault')}` : ''}
                  </option>
                ))}
            </Select>
          </Field>
        ))}
      </div>
      {(onRefreshDevices || onSystemDefaults) && (
        <div className="flex flex-wrap gap-2">
          {onRefreshDevices && (
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw size={14} aria-hidden="true" />}
              disabled={!!active || busy || devicesLoading || !desktop}
              onClick={onRefreshDevices}
            >
              {key('refreshDevices')}
            </Button>
          )}
          {onSystemDefaults && (
            <Button
              size="sm"
              variant="ghost"
              disabled={!!active || busy || devicesLoading || !desktop}
              onClick={onSystemDefaults}
            >
              {key('useSystemDefaults')}
            </Button>
          )}
        </div>
      )}
      {devicesLoading && (
        <p role="status" className="text-xs text-muted-foreground">
          {key('loadingDevices')}
        </p>
      )}
      {devicesFailed && <Alert tone="error">{key('devicesFailed')}</Alert>}
      {desktop && !devicesLoading && !sources.some((s) => s.monitor) && (
        <p className="text-sm text-muted-foreground">{key('noMonitor')}</p>
      )}
      {active && (
        <>
          {!fixedTitle && (
            <RecordingInformation storage={active.storage} elapsedMs={active.elapsedMs} />
          )}
          <p role="status" className="text-sm">
            {key(active.paused ? 'paused' : 'recording')} · {Math.floor(active.elapsedMs / 1000)}s
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Level label={key('mic')} meter={active.mic} paused={active.paused} />
            <Level label={key('output')} meter={active.output} paused={active.paused} />
          </div>
        </>
      )}
      {showActions && (
        <div className="flex flex-wrap gap-2">
          {!active ? (
            <Button
              variant="primary"
              icon={<Play size={14} aria-hidden="true" />}
              disabled={
                !desktop ||
                busy ||
                devicesLoading ||
                !!status.processing ||
                !title.trim() ||
                !validSources(sources, mic, output)
              }
              onClick={onStart}
            >
              {key('start')}
            </Button>
          ) : (
            <>
              <Button
                icon={
                  active.paused ? (
                    <Play size={14} aria-hidden="true" />
                  ) : (
                    <Pause size={14} aria-hidden="true" />
                  )
                }
                disabled={busy}
                onClick={onPause}
              >
                {key(active.paused ? 'resume' : 'pause')}
              </Button>
              <Button
                variant="primary"
                icon={<Square size={14} aria-hidden="true" />}
                disabled={busy}
                onClick={onStop}
              >
                {key('stop')}
              </Button>
            </>
          )}
          {allowImport && (
            <Button
              icon={<FileAudio size={14} aria-hidden="true" />}
              disabled={!desktop || busy || !!active || !!status.processing || !title.trim()}
              onClick={onImport}
            >
              {key('importAudio')}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
function Level({ label, meter, paused }: { label: string; meter: Meter; paused: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <label className="text-sm">
        {label}
        <meter
          aria-label={label}
          min={0}
          max={1}
          value={Math.max(0, Math.min(1, meter.peak))}
          className="block w-full"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {t(`library.diagnostic.${meterDiagnostic(meter, paused)}`)}
        {meter.error ? `: ${meter.error}` : ''}
      </p>
    </div>
  );
}
