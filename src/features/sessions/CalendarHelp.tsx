import { useTranslation } from 'react-i18next';
import { CircleHelp } from 'lucide-react';

export function CalendarHelp() {
  const { t } = useTranslation();
  return (
    <details className="group text-ui text-muted-foreground">
      <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm py-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <CircleHelp size={14} aria-hidden="true" />
        {t('sessionCalendar.help')}
      </summary>
      <div className="mt-2 max-w-3xl space-y-2 rounded-md border border-border bg-background p-4 text-xs leading-relaxed">
        <p>{t('sessionCalendar.subtitle')}</p>
        <p>{t('sessionCalendar.filterHelp')}</p>
        <p>{t('sessionCalendar.gridHelp')}</p>
        <p>{t('sessionCalendar.listHelp')}</p>
        <p>{t('sessionCalendar.customHelp')}</p>
        <p>{t('sessionCalendar.undatedHelp')}</p>
      </div>
    </details>
  );
}
