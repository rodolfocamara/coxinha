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
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.calendarMatch.${key}`, options);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
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
          {matches.map((match) => (
            <MatchRow
              key={`${match.sessionId}:${match.event.id}`}
              match={match}
              disabled={busy !== null}
              onAnswer={(accept) => void answer(match, accept)}
            />
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

function MatchRow({
  match,
  disabled,
  onAnswer,
}: {
  match: CalendarMatch;
  disabled: boolean;
  onAnswer: (accept: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.calendarMatch.${key}`, options);
  const day = new Intl.DateTimeFormat(i18n.language, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const [eventStart, eventEnd] = [match.event.startsAt, match.event.endsAt].map((v) => new Date(v));
  const [recordStart, recordEnd] = [match.startsAt, match.endsAt].map((v) => new Date(v));
  const sameDay = day.format(eventStart) === day.format(recordStart);
  const recorded = `${sameDay ? '' : `${day.format(recordStart)} · `}${time.format(recordStart)}–${time.format(recordEnd)}`;
  const invitees = match.event.attendees.length;
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="min-w-0">
        <p className="font-medium text-foreground break-words">{match.event.title}</p>
        <p className="text-sm text-muted-foreground tabular-nums">
          {day.format(eventStart)} · {time.format(eventStart)}–{time.format(eventEnd)}
          {invitees > 0 && ` · ${k('invitees', { count: invitees })}`}
        </p>
      </div>
      <div className="flex flex-col gap-2 rounded-md bg-muted px-3 py-2.5">
        <p className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
          <span className="truncate text-muted-foreground" title={match.title}>
            {k('recorded', { title: match.title })}
          </span>
          <span className="shrink-0 text-foreground tabular-nums">
            {recorded} · {duration(recordEnd.getTime() - recordStart.getTime())}
          </span>
        </p>
        <Coverage event={[eventStart, eventEnd]} recording={[recordStart, recordEnd]} />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          icon={<Check size={14} aria-hidden="true" />}
          disabled={disabled}
          onClick={() => onAnswer(true)}
          aria-label={k('acceptLabel', { title: match.event.title })}
        >
          {k('accept')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<X size={14} aria-hidden="true" />}
          disabled={disabled}
          onClick={() => onAnswer(false)}
          aria-label={k('declineLabel', { title: match.event.title })}
        >
          {k('decline')}
        </Button>
      </div>
    </li>
  );
}

/** The meeting's slot above the recording, on one shared time axis. */
function Coverage({ event, recording }: { event: [Date, Date]; recording: [Date, Date] }) {
  const from = Math.min(event[0].getTime(), recording[0].getTime());
  const span = Math.max(event[1].getTime(), recording[1].getTime()) - from || 1;
  const box = ([a, b]: [Date, Date]) => ({
    left: `${((a.getTime() - from) / span) * 100}%`,
    width: `${Math.max(((b.getTime() - a.getTime()) / span) * 100, 1)}%`,
  });
  return (
    <div className="flex flex-col gap-1" aria-hidden="true">
      {[
        [event, 'bg-foreground/25'],
        [recording, 'bg-primary'],
      ].map(([range, tone]) => (
        <div key={String(tone)} className="relative h-1 rounded-full bg-foreground/5">
          <div
            className={`absolute inset-y-0 rounded-full ${tone}`}
            style={box(range as [Date, Date])}
          />
        </div>
      ))}
    </div>
  );
}

function duration(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}
