import { useTranslation } from 'react-i18next';
import { EmptyState, Sheet } from '../../components/ui';
import type { Attention, MeetingRow } from './meetingRows';
import { MeetingRowList } from './MeetingRowList';

/**
 * "A revisar" (spec 0107): meetings waiting for recovery or a transcript,
 * most recent first. Picking one opens its full page.
 */
export function ReviewSheet({
  open,
  onOpenChange,
  rows,
  now,
  isLive,
  attention,
  onOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: MeetingRow[];
  now: Date;
  isLive: (row: MeetingRow) => boolean;
  attention: (row: MeetingRow) => Attention;
  onOpen: (row: MeetingRow) => void;
}) {
  const { t } = useTranslation();
  const k = (key: string) => t(`meetingsHub.${key}`);
  const sorted = [...rows].sort(
    (a, b) => (b.start?.getTime() ?? 0) - (a.start?.getTime() ?? 0) || a.key.localeCompare(b.key)
  );
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('meetingsHub.home.review')}
      description={t('meetingsHub.home.reviewHint')}
      closeLabel={k('close')}
    >
      {sorted.length ? (
        <MeetingRowList
          rows={sorted}
          now={now}
          isLive={isLive}
          attention={attention}
          onSelect={onOpen}
        />
      ) : (
        <EmptyState title={k('reviewEmpty')} description={k('reviewEmptyHint')} />
      )}
    </Sheet>
  );
}
