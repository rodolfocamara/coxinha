import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui';
import type { AppConfig } from '../../lib/bindings';
import { SettingsCard, SettingsRow, SettingsSection } from './controls';

const NONE = { engine: 'none' } as const;
const file = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

function describe(engine: AppConfig['transcriber'] | AppConfig['diarizer']) {
  switch (engine.engine) {
    case 'none':
      return null;
    case 'whisper':
      return `Whisper · ${file(engine.model_path)} · ${engine.accelerator}`;
    case 'parakeet':
      return `Parakeet · ${file(engine.model_dir)} · ${engine.accelerator}`;
    case 'pyannote':
      return `pyannote · ${file(engine.segmentation_model)}`;
    case 'speakrs':
      return `speakrs · ${file(engine.model_dir)} · ${engine.accelerator}`;
  }
}

/** Transcrição local: what the app config holds today (read-only; models are picked per meeting). */
export function TranscriptionSection({ config }: { config: AppConfig }) {
  const { t } = useTranslation();
  const s = (key: string) => t(`people.settings.${key}`);
  const row = (
    name: string,
    title: string,
    engine: AppConfig['transcriber'] | AppConfig['diarizer']
  ) => {
    const detail = describe(engine);
    return (
      <SettingsRow
        name={name}
        title={title}
        description={detail ?? s('transcription.noDefault')}
        control={
          <Badge tone={detail ? 'success' : 'neutral'}>
            {s(detail ? 'transcription.configured' : 'transcription.notConfigured')}
          </Badge>
        }
      />
    );
  };
  return (
    <SettingsSection
      id="transcription"
      headingId="transcription-heading"
      title={s('sections.transcription')}
      description={s('descriptions.transcription')}
    >
      <SettingsCard>
        {row('transcriber', s('transcription.engine'), config.transcriber ?? NONE)}
        {row('diarizer', s('transcription.diarizer'), config.diarizer ?? NONE)}
      </SettingsCard>
      <p className="mt-2 text-xs text-muted-foreground">{s('transcription.perMeeting')}</p>
    </SettingsSection>
  );
}
