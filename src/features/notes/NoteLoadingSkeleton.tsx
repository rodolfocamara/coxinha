import { useTranslation } from 'react-i18next';

export function NoteLoadingSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="p-8 space-y-3 animate-pulse">
      <span className="sr-only">{t('editor.loading')}</span>
      <div className="h-8 w-1/2 bg-muted rounded" aria-hidden="true" />
      <div className="h-4 w-full bg-muted rounded" aria-hidden="true" />
      <div className="h-4 w-5/6 bg-muted rounded" aria-hidden="true" />
      <div className="h-4 w-4/6 bg-muted rounded" aria-hidden="true" />
    </div>
  );
}
