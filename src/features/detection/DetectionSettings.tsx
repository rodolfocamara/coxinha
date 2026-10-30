import { useTranslation } from 'react-i18next';
import { setDetectionEnabled, useMeetingDetection } from './meetingDetection';
import { Alert } from '../../components/ui';
export function DetectionSettings() {
  const { t } = useTranslation();
  const { enabled, status, failed } = useMeetingDetection();
  return (
    <section aria-labelledby="detection-heading" className="space-y-3">
      <h2 id="detection-heading">{t('meetingDetection.settings')}</h2>
      <label className="flex cursor-pointer items-center gap-3 text-ui font-medium">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={enabled}
          onChange={(e) => setDetectionEnabled(e.target.checked)}
        />
        {t('meetingDetection.enable')}
      </label>
      <p className="text-sm text-muted-foreground">{t('meetingDetection.description')}</p>
      {status && !status.supported && (
        <Alert tone="info">{t('meetingDetection.unsupported')}</Alert>
      )}
      {enabled && (failed || status?.unavailable) && (
        <Alert tone="warning">{t('meetingDetection.unavailable')}</Alert>
      )}
    </section>
  );
}
