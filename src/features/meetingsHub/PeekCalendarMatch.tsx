import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { Button } from '../../components/ui';
import type { CalendarEvent } from '../agenda/calendar';
import { colourVar, useEventColour } from '../agenda/categories';
import { library, type CalendarMatch } from '../meetings/library';
import { refreshSessionList } from '../sessions/sessions';
import { matchCandidates } from './peekMatch';

/**
 * "É esta reunião?" in the peek of a recording that is not on the calendar
 * (spec 0111): the likely event first, the others around it to pick from.
 */
export function PeekCalendarMatch({
  sessionId,
  start,
  durationMs,
  events,
  proposal,
  onResolved,
  onFocus,
}: {
  sessionId: string;
  start: Date;
  durationMs: number | null;
  events: CalendarEvent[];
  proposal: CalendarMatch | null;
  onResolved: () => void;
  /** The event checked while the question is open, for the calendar to single out. */
  onFocus?: (eventId: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.calendarMatch.${key}`, options);
  const candidates = matchCandidates(events, start, durationMs, proposal?.event ?? null);
  const [open, setOpen] = useState(!!proposal);
  const [chosen, setChosen] = useState(candidates[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const focused = open && candidates.some((e) => e.id === chosen) ? chosen : null;
  useEffect(() => {
    onFocus?.(focused);
  }, [focused, onFocus]);
  useEffect(() => () => onFocus?.(null), [onFocus]);
  if (candidates.length === 0) return null;
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' });

  async function answer(eventId: string, accept: boolean) {
    setBusy(true);
    setError('');
    try {
      await library.resolveCalendarMatch(sessionId, eventId, accept);
      if (accept) await refreshSessionList();
      onResolved();
      if (!accept) setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button type="button" className="ch-peek-link" onClick={() => setOpen(true)}>
        {k('link')}
      </button>
    );
  return (
    <section className="ch-peek-sec ch-match" aria-labelledby="ch-match-h">
      <h3 id="ch-match-h" className="ch-peek-h">
        {k(proposal ? 'question' : 'pick')}
      </h3>
      <div role="radiogroup" aria-labelledby="ch-match-h" className="ch-match-list">
        {candidates.map((event) => (
          <Candidate
            key={event.id}
            event={event}
            checked={chosen === event.id}
            likely={event.id === proposal?.event.id}
            when={`${time.format(new Date(event.startsAt))}–${time.format(new Date(event.endsAt))}`}
            onChoose={() => setChosen(event.id)}
          />
        ))}
      </div>
      {error && (
        <p className="ch-peek-error" role="alert">
          {error}
        </p>
      )}
      <div className="ch-peek-actions">
        <Button
          size="sm"
          variant="primary"
          icon={<Check size={14} aria-hidden="true" />}
          disabled={busy || !chosen}
          onClick={() => void answer(chosen, true)}
        >
          {k('accept')}
        </Button>
        {proposal ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void answer(proposal.event.id, false)}
          >
            {k('none')}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
            {k('cancel')}
          </Button>
        )}
      </div>
    </section>
  );
}

function Candidate({
  event,
  checked,
  likely,
  when,
  onChoose,
}: {
  event: CalendarEvent;
  checked: boolean;
  likely: boolean;
  when: string;
  onChoose: () => void;
}) {
  const { t } = useTranslation();
  const colour = useEventColour(event);
  const invitees = event.attendees.length;
  return (
    <label className="ch-match-row" data-checked={checked || undefined}>
      <input type="radio" name="ch-match" checked={checked} onChange={onChoose} />
      <i
        className="ch-match-bar"
        aria-hidden="true"
        style={colour ? { background: colourVar(colour.preset) } : undefined}
      />
      <span className="ch-match-text">
        <b>{event.title}</b>
        <span>
          {when}
          {invitees > 0 && ` · ${t('meetingsHub.calendarMatch.invitees', { count: invitees })}`}
          {likely && ` · ${t('meetingsHub.calendarMatch.likely')}`}
        </span>
      </span>
    </label>
  );
}
