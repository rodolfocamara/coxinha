import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, Check, X } from 'lucide-react';
import { Alert, Button, Sheet } from '../../components/ui';
import { library, type CalendarMatch } from '../meetings/library';
import { onCalendarChanged } from '../agenda/calendar';
import { refreshSessionList } from '../sessions/sessions';

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

export function CalendarMatchSheet({
  open,
  onOpenChange,
  matches,
  onResolved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matches: CalendarMatch[];
  onResolved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.calendarMatch.${key}`, options);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const day = new Intl.DateTimeFormat(i18n.language, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const span = (from: string, to: string) =>
    `${day.format(new Date(from))} · ${time.format(new Date(from))}–${time.format(new Date(to))}`;
  const answer = async (match: CalendarMatch, accept: boolean) => {
    setBusy(match.sessionId);
    setError('');
    try {
      await library.resolveCalendarMatch(match.sessionId, match.event.id, accept);
      if (accept) await refreshSessionList();
      onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={k('title')}
      description={k('description')}
      closeLabel={t('meetingsHub.close')}
    >
      <div className="flex flex-col gap-3">
        {matches.length === 0 && <Alert tone="success">{k('done')}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <ul className="flex flex-col gap-3" aria-label={k('title')}>
          {matches.map((match) => {
            const invitees = match.event.attendees.length;
            return (
              <li
                key={`${match.sessionId}:${match.event.id}`}
                className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-3"
              >
                <div className="text-xs text-muted">
                  {k('recording', { title: match.title, when: span(match.startsAt, match.endsAt) })}
                </div>
                <div className="font-medium">{match.event.title}</div>
                <div className="text-xs text-muted">
                  {span(match.event.startsAt, match.event.endsAt)}
                  {invitees > 0 && ` · ${k('invitees', { count: invitees })}`}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Check size={14} aria-hidden="true" />}
                    disabled={busy !== null}
                    onClick={() => void answer(match, true)}
                    aria-label={k('acceptLabel', { title: match.event.title })}
                  >
                    {k('accept')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<X size={14} aria-hidden="true" />}
                    disabled={busy !== null}
                    onClick={() => void answer(match, false)}
                    aria-label={k('declineLabel', { title: match.event.title })}
                  >
                    {k('decline')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Sheet>
  );
}
