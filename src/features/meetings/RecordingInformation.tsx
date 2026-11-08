import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RecordingStorage } from './library';

export function audioTime(seconds: number) {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return [Math.floor(value / 3600), Math.floor((value % 3600) / 60), value % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

export function RecordingInformation({
  storage,
  elapsedMs,
  processing,
}: {
  storage?: RecordingStorage | null;
  elapsedMs?: number;
  processing?: string;
}) {
  const { t, i18n } = useTranslation();
  const [copy, setCopy] = useState<'copied' | 'copyFailed' | null>(null);
  const bytes = (value: number | null | undefined) => {
    if (value == null) return t('recordingInfo.unavailable');
    const unit = value < 1024 ? 'B' : value < 1048576 ? 'KiB' : 'MiB';
    const divisor = unit === 'B' ? 1 : unit === 'KiB' ? 1024 : 1048576;
    return `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value / divisor)} ${unit}`;
  };
  if (!storage && elapsedMs == null && !processing) return null;
  return (
    <div className="space-y-2 text-xs text-muted-foreground" aria-label={t('recordingInfo.label')}>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 tabular-nums">
        {elapsedMs != null && (
          <div>
            <dt className="inline">{t('recordingInfo.elapsed')} </dt>
            <dd className="inline text-foreground">{audioTime(elapsedMs / 1000)}</dd>
          </div>
        )}
        <div>
          <dt className="inline">{t('recordingInfo.duration')} </dt>
          <dd className="inline text-foreground">
            {storage?.durationMs == null
              ? t('recordingInfo.unavailable')
              : audioTime(storage.durationMs / 1000)}
          </dd>
        </div>
        <div>
          <dt className="inline">{t('recordingInfo.size')} </dt>
          <dd className="inline text-foreground">{bytes(storage?.totalBytes)}</dd>
        </div>
      </dl>
      {processing && (
        <p role="status">
          {t(
            `desktopRecording.${processing === 'validation' ? 'validating' : processing === 'stopping' ? 'stoppingProcessing' : 'processing'}`
          )}{' '}
          · {t('recordingInfo.noEstimate')}
        </p>
      )}
      {storage && (
        <details onToggle={() => setCopy(null)}>
          <summary className="cursor-pointer w-fit rounded focus-visible:outline focus-visible:outline-ring">
            {t('recordingInfo.files')}
          </summary>
          <div className="mt-2 space-y-2">
            <p className="select-text break-all text-foreground">{storage.directory}</p>
            <button
              type="button"
              className="underline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(storage.directory);
                  setCopy('copied');
                } catch {
                  setCopy('copyFailed');
                }
              }}
            >
              {t('recordingInfo.copyPath')}
            </button>
            {copy && (
              <span role="status" className="ml-2">
                {t(`recordingInfo.${copy}`)}
              </span>
            )}
            <ul>
              {storage.files.map((file) => (
                <li key={file.name}>
                  {file.name} · {bytes(file.bytes)}
                </li>
              ))}
            </ul>
            <p>{t(elapsedMs == null ? 'recordingInfo.originals' : 'recordingInfo.liveBytes')}</p>
          </div>
        </details>
      )}
    </div>
  );
}
