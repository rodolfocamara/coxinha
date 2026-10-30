import { useTranslation } from 'react-i18next';
import { OutlookConnectionCard } from '../agenda/OutlookConnectionCard';
import { useOutlookConnection } from '../agenda/useOutlookConnection';

/** External accounts. Mounting reads only local caches; nothing connects implicitly. */
export function IntegrationsSection({ onOpenAgenda }: { onOpenAgenda?: () => void }) {
  const { t } = useTranslation();
  const outlook = useOutlookConnection();
  return (
    <section aria-labelledby="integrations-heading" className="settings-plain space-y-3">
      <div>
        <h2 id="integrations-heading">{t('settings.integrations.heading')}</h2>
        <p className="mt-1 text-ui text-muted-foreground">
          {t('settings.integrations.description')}
        </p>
      </div>
      <OutlookConnectionCard
        connection={outlook}
        onOpenAgenda={onOpenAgenda}
        titleId="integrations-outlook-heading"
      />
    </section>
  );
}
