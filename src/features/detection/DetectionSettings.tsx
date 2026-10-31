import { useTranslation } from 'react-i18next';
import { setDetectionEnabled, useMeetingDetection } from './meetingDetection';
import { Alert } from '../../components/ui';
import { SettingsRow, Switch } from '../settings/controls';

/** Call detection switch, rendered as a row of the Ajustes > Gravação card. */
export function DetectionSettings() {
  const { t } = useTranslation();
  const { enabled, status, failed } = useMeetingDetection();
  const unsupported = !!status && !status.supported;
  const unavailable = enabled && (failed || !!status?.unavailable);
  return (
    <SettingsRow
      name="detection"
      titleId="detection-heading"
      title={t('people.settings.detection.title')}
      description={t('people.settings.detection.hint')}
      control={
        <Switch
          name="detection"
          labelledBy="detection-heading"
          checked={enabled}
          onChange={setDetectionEnabled}
        />
      }
      below={
        (unsupported || unavailable) && (
          <>
            {unsupported && <Alert tone="info">{t('meetingDetection.unsupported')}</Alert>}
            {unavailable && <Alert tone="warning">{t('meetingDetection.unavailable')}</Alert>}
          </>
        )
      }
    />
  );
}
