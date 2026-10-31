import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui';
import { updateAutoRecord, useAutoRecord } from '../capture/autoRecord';
import { SettingsRow, Switch } from '../settings/controls';
import { setDetectionEnabled, useMeetingDetection } from './meetingDetection';

/** Ajustes > Gravação rows for spec 0097. Hidden until the backend answers. */
export function AutoRecordSettings() {
  const { t } = useTranslation();
  const k = (key: string) => t(`people.settings.autoRecord.${key}`);
  const settings = useAutoRecord((s) => s.status?.settings);
  const detecting = useMeetingDetection((s) => s.enabled);
  const unsupported = useMeetingDetection((s) => !!s.status && !s.status.supported);
  if (!settings) return null;
  const toggle = (enabled: boolean) => {
    // ADR 0023: auto-record needs detection; the backend enables it too.
    if (enabled && !detecting) setDetectionEnabled(true);
    void updateAutoRecord({ enabled });
  };
  return (
    <>
      <SettingsRow
        name="auto-record"
        title={k('title')}
        description={k('hint')}
        control={
          <Switch
            name="auto-record"
            checked={settings.enabled}
            disabled={unsupported}
            onChange={toggle}
          />
        }
        below={
          !detecting && !settings.enabled && <Alert tone="info">{k('needsDetection')}</Alert>
        }
      />
      {settings.enabled && (
        <SettingsRow
          name="auto-stop"
          title={k('stopTitle')}
          description={k('stopHint')}
          control={
            <Switch
              name="auto-stop"
              checked={settings.stopWhenCallEnds}
              onChange={(stopWhenCallEnds) => void updateAutoRecord({ stopWhenCallEnds })}
            />
          }
        />
      )}
    </>
  );
}
