import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Video } from 'lucide-react';
import { Button } from '../../components/ui';
import { calendar, type CalendarEvent } from '../agenda/calendar';
import { attendeeGroups, myResponse } from './eventDetails';
import './signals.css';

const OPEN_WHEN_AT_MOST = 8;

/**
 * What Outlook knows about an event (spec 0124 P2). Everything here comes from
 * other people: names and the preview are text, and links open by event id.
 */
export function EventDetails({
  event,
  ended,
  headingClassName = 'ch-peek-h',
}: {
  event: CalendarEvent;
  ended: boolean;
  headingClassName?: string;
}) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.eventDetails.${key}`, options);
  const [failed, setFailed] = useState(false);
  const response = myResponse(event);
  const invitees = attendeeGroups(event);
  const open = (link: 'join' | 'outlook') => {
    setFailed(false);
    calendar.openLink(event.id, link).catch(() => setFailed(true));
  };
  const flat = !invitees && event.attendees.length > 0;
  return (
    <section className="ch-peek-sec" aria-label={k('label')}>
      {response && <p className="ch-event-line">{k(`mine.${response}`)}</p>}
      {event.location && (
        <p className="ch-event-line">{k('location', { location: event.location })}</p>
      )}
      {(invitees || flat) && (
        <h3 className={headingClassName}>
          {invitees
            ? k('inviteesCount', {
                count: invitees.total,
                required: invitees.required,
                optional: invitees.optional,
              })
            : t('meetingsHub.home.invitees')}
        </h3>
      )}
      {flat && (
        <p className="ch-event-line">
          {event.attendees
            .slice(0, 6)
            .map((p) => p.name || p.email)
            .join(', ')}
          {event.attendees.length > 6 ? ` +${event.attendees.length - 6}` : ''}
        </p>
      )}
      {invitees?.groups.map((group) => (
        <details
          key={group.id}
          className="ch-event-group"
          open={group.people.length <= OPEN_WHEN_AT_MOST}
        >
          <summary>{k(`group.${group.id}`, { count: group.people.length })}</summary>
          <p className="ch-event-line">
            {group.people
              .map((p) => (p.kind === 'optional' ? k('optionalPerson', { name: p.name }) : p.name))
              .join(', ')}
          </p>
        </details>
      ))}
      {event.bodyPreview && <p className="ch-event-preview">{event.bodyPreview}</p>}
      <div className="ch-event-actions">
        {event.joinUrl && !ended && (
          <Button
            variant="secondary"
            size="sm"
            icon={<Video size={14} aria-hidden="true" />}
            onClick={() => open('join')}
          >
            {k('join')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon={<ExternalLink size={14} aria-hidden="true" />}
          onClick={() => open('outlook')}
        >
          {k('openInOutlook')}
        </Button>
      </div>
      {failed && (
        <p className="ch-peek-error" role="alert">
          {k('openFailed')}
        </p>
      )}
    </section>
  );
}
