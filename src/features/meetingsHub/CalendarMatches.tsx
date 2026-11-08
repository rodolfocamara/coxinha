import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck } from 'lucide-react';
import { library, type CalendarMatch } from '../meetings/library';
import { onCalendarChanged } from '../agenda/calendar';
import { refreshSessionList } from '../sessions/sessions';

/**
 * Spec 0100: earlier recordings that overlap a calendar event. Read again
 * when the Outlook cache changes; nothing is applied without an answer.
 * Reading also joins confirmed recordings to their prepared session (spec
 * 0115 P3), so the session list is read again after it.
 */
export function useCalendarMatches(enabled: boolean) {
  const [matches, setMatches] = useState<CalendarMatch[]>([]);
  const reload = useCallback(() => {
    if (!enabled) return;
    library.calendarMatches().then(
      (next) => {
        setMatches(next);
        void refreshSessionList();
      },
      () => setMatches([])
    );
  }, [enabled]);
  useEffect(() => {
    reload();
    return onCalendarChanged(reload);
  }, [reload]);
  return { matches, reload };
}

/** The rail's entry to the recordings to link (spec 0111 P2), shaped like "A revisar". */
export function CalendarMatchBanner({ count, onReview }: { count: number; onReview: () => void }) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <button
      type="button"
      className="ch-review"
      onClick={onReview}
      title={t('meetingsHub.calendarMatch.banner', { count })}
    >
      <CalendarCheck size={14} aria-hidden="true" />
      <span className="flex-1">{t('meetingsHub.calendarMatch.review')}</span>
      <span className="mh-pill">
        <span className="sr-only">{t('meetingsHub.calendarMatch.banner', { count })}</span>
        <span aria-hidden="true">{count}</span>
      </span>
    </button>
  );
}
