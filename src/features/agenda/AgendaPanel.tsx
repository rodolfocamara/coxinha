import { useTranslation } from 'react-i18next';
export function AgendaPanel() {
  const { t } = useTranslation();
  return (
    <aside className="p-5 space-y-3">
      <h2>{t('outlook.connection')}</h2>
      <p className="text-sm text-muted-foreground">{t('outlook.candidateHint')}</p>
      <p className="text-sm text-muted-foreground">{t('outlook.noAutoRecord')}</p>
    </aside>
  );
}
