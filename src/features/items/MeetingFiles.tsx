import { useTranslation } from 'react-i18next';
import { ClipboardList } from 'lucide-react';
import { Button, EmptyState } from '../../components/ui';
import { ItemFiles } from './ItemFiles';
import { civilDate } from './items';

/** "Arquivos" tab of a meeting: files need a session to belong to. */
export function MeetingFiles({
  sessionId,
  title,
  start,
  kind,
  busy,
  onPrepare,
}: {
  sessionId: string | null;
  title: string;
  start: Date | null;
  kind: 'session' | 'event' | 'recording';
  busy: boolean;
  onPrepare: () => void;
}) {
  const { t } = useTranslation();
  if (sessionId)
    return <ItemFiles item={{ kind: 'meeting', id: sessionId, title, date: civilDate(start) }} />;
  return (
    <EmptyState
      title={t('items.files.title')}
      description={t('items.files.eventHint')}
      action={
        kind === 'event' ? (
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={onPrepare}
            icon={<ClipboardList size={14} aria-hidden="true" />}
          >
            {t('meetingsHub.notes.prepare')}
          </Button>
        ) : undefined
      }
    />
  );
}
