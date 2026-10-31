import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Select } from '../../components/ui';
import { chooseDevices, loadDevices } from '../capture/captureActions';
import { useCaptureStore } from '../capture/captureStore';
import { DetectionSettings } from '../detection/DetectionSettings';
import { library, type Source } from '../meetings/library';
import { SettingsCard, SettingsRow, SettingsSection } from './controls';

function DeviceSelect({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: Source[];
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const label = (source: Source) => {
    const text = source.description || source.name;
    return source.is_default ? t('people.settings.devices.systemDefault', { name: text }) : text;
  };
  return (
    <Select
      block
      size="sm"
      value={options.length ? value : ''}
      disabled={options.length === 0}
      aria-labelledby={`${name}-title`}
      aria-describedby={`${name}-desc`}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.length === 0 ? (
        <option value="">{t('people.settings.devices.none')}</option>
      ) : (
        options.map((source) => (
          <option key={source.name} value={source.name}>
            {label(source)}
          </option>
        ))
      )}
    </Select>
  );
}

/**
 * Gravação: which microphone and computer audio the recorder uses, plus call
 * detection. Choices go through `chooseDevices`; this screen never starts,
 * pauses or stops a capture.
 */
export function RecordingSection() {
  const { t } = useTranslation();
  const s = (key: string) => t(`people.settings.${key}`);
  const sources = useCaptureStore((state) => state.sources);
  const mic = useCaptureStore((state) => state.mic);
  const output = useCaptureStore((state) => state.output);
  const failed = useCaptureStore((state) => state.failure === 'devices');
  const live = useCaptureStore((state) => !!state.status?.active);
  const available = library.available();
  const [loading, setLoading] = useState(false);
  const refresh = () => {
    setLoading(true);
    void loadDevices().finally(() => setLoading(false));
  };
  useEffect(() => {
    if (available && sources.length === 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);
  const mics = sources.filter((source) => !source.monitor);
  const outputs = sources.filter((source) => source.monitor);
  const status = !available ? (
    <Alert tone="info">{t('library.desktopRequired')}</Alert>
  ) : loading && sources.length === 0 ? (
    <p role="status" className="text-xs text-muted-foreground">
      {s('devices.loading')}
    </p>
  ) : failed && sources.length === 0 ? (
    <Alert
      tone="error"
      action={
        <Button size="sm" onClick={refresh}>
          {s('devices.retry')}
        </Button>
      }
    >
      {s('devices.error')}
    </Alert>
  ) : live ? (
    <p className="text-xs text-muted-foreground">{s('devices.liveNote')}</p>
  ) : null;
  return (
    <SettingsSection
      id="recording"
      headingId="recording-heading"
      title={s('sections.recording')}
      description={s('descriptions.recording')}
    >
      <SettingsCard>
        <SettingsRow
          name="mic"
          title={s('mic.title')}
          description={s('mic.hint')}
          control={
            available && (
              <DeviceSelect
                name="mic"
                value={mic}
                options={mics}
                onChange={(value) => chooseDevices({ mic: value })}
              />
            )
          }
        />
        <SettingsRow
          name="output"
          title={s('output.title')}
          description={s('output.hint')}
          control={
            available && (
              <DeviceSelect
                name="output"
                value={output}
                options={outputs}
                onChange={(value) => chooseDevices({ output: value })}
              />
            )
          }
          below={status}
        />
        <DetectionSettings />
      </SettingsCard>
    </SettingsSection>
  );
}
