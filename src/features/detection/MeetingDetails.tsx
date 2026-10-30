import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '../../components/ui/Select';
import { calendar, type CalendarEvent } from '../agenda/calendar';

/** Suggestions only: a matching time is not proof of the detected call's identity. */
export function nearbyInvitations(events: CalendarEvent[], now = Date.now()) {
  return events
    .filter((e) => {
      const start = Date.parse(e.startsAt),
        end = Date.parse(e.endsAt);
      return !e.cancelled && !e.allDay && start <= now + 15 * 60_000 && end > now && start < end;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
export function MeetingDetails({
  title,
  setTitle,
  event,
  setEvent,
  disabled,
}: {
  title: string;
  setTitle: (title: string) => void;
  event?: CalendarEvent;
  setEvent: (event?: CalendarEvent) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    let live = true;
    void calendar
      .status()
      .then((snapshot) => {
        if (live) {
          setEvents(snapshot.account ? nearbyInvitations(snapshot.events) : []);
          setState('ready');
        }
      })
      .catch(() => {
        if (live) setState('failed');
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="space-y-2 max-w-lg">
      <label className="block space-y-1">
        <span>{t('meetingDetection.invitation')}</span>
        <Select
          aria-label={t('meetingDetection.invitation')}
          disabled={disabled || state !== 'ready'}
          value={event?.id ?? ''}
          onChange={(e) => {
            const selected = events.find((entry) => entry.id === e.target.value);
            setEvent(selected);
            if (selected) setTitle(selected.title);
          }}
        >
          <option value="">{t('meetingDetection.noInvitation')}</option>
          {events.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.title}
            </option>
          ))}
        </Select>
      </label>
      <label className="block space-y-1">
        <span>{t('session.title')}</span>
        <input
          className="w-full rounded border bg-background px-3 py-2"
          maxLength={500}
          value={title}
          disabled={disabled || !!event}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {t(
          state === 'failed'
            ? 'meetingDetection.calendarFailed'
            : state === 'loading'
              ? 'meetingDetection.calendarLoading'
              : 'meetingDetection.calendarHelp'
        )}
      </p>
      {event && (
        <p className="text-xs text-muted-foreground">
          {t('meetingDetection.invitees', { count: event.attendees.length })}
        </p>
      )}
    </div>
  );
}
