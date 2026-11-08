import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Star, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '../../components/ui';
import { library, type MeetingMark } from '../meetings/library';
import { PropRow } from './PropertySheet';
import { SIGNALS_KEY, useSignalsReport } from './meetingSignals';

/**
 * Spec 0124 P5, a past meeting: the owner's mark, as a toggle on its row.
 * Generated content never stands in for it. The words beside the icons say what
 * was chosen, so the state does not rest on a pressed look alone.
 */
export function MarkRow({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const k = (key: string) => t(`meetingsHub.signals.state.${key}`);
  const client = useQueryClient();
  const report = useSignalsReport();
  const [failed, setFailed] = useState(false);
  const signals = report.data?.sessions.find((s) => s.sessionId === sessionId);
  if (!report.data || !signals) return null;
  const choose = (mark: MeetingMark) => {
    setFailed(false);
    library
      .setMark(sessionId, signals.mark === mark ? null : mark)
      .then(() => client.invalidateQueries({ queryKey: SIGNALS_KEY }))
      .catch(() => setFailed(true));
  };
  return (
    <PropRow icon={Star} label={t('meetingDetail.rows.mark')}>
      <span className="ch-mark ch-prop-mark" role="group" aria-label={k('markLabel')}>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          icon={<ThumbsUp size={14} aria-hidden="true" />}
          aria-label={k('useful')}
          title={k('useful')}
          aria-pressed={signals.mark === 'useful'}
          onClick={() => choose('useful')}
        />
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          icon={<ThumbsDown size={14} aria-hidden="true" />}
          aria-label={k('notUseful')}
          title={k('notUseful')}
          aria-pressed={signals.mark === 'notUseful'}
          onClick={() => choose('notUseful')}
        />
        {signals.mark && <span className="ch-prop-mark-state">{k(signals.mark)}</span>}
      </span>
      {failed && (
        <p className="ch-peek-error" role="alert">
          {k('markFailed')}
        </p>
      )}
    </PropRow>
  );
}
