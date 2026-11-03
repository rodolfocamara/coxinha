import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck } from 'lucide-react';
import { Alert, Button } from '../../components/ui';
import { library, type CalendarMatch } from '../meetings/library';
import { onCalendarChanged } from '../agenda/calendar';

/**
 * Spec 0100: earlier recordings that overlap a calendar event. Read again
 * when the Outlook cache changes; nothing is applied without an answer.
 */
export function useCalendarMatches(enabled: boolean) {
  const [matches, setMatches] = useState<CalendarMatch[]>([]);
  const reload = useCallback(() => {
    if (!enabled) return;
    library.calendarMatches().then(setMatches, () => setMatches([]));
  }, [enabled]);
  useEffect(() => {
    reload();
    return onCalendarChanged(reload);
  }, [reload]);
  return { matches, reload };
}

export function CalendarMatchBanner({ count, onReview }: { count: number; onReview: () => void }) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <div className="p-3 pb-0">
      <Alert
        tone="info"
        action={
          <Button
            size="sm"
            icon={<CalendarCheck size={14} aria-hidden="true" />}
            onClick={onReview}
          >
            {t('meetingsHub.calendarMatch.review')}
          </Button>
        }
      >
        {t('meetingsHub.calendarMatch.banner', { count })}
      </Alert>
    </div>
  );
}
