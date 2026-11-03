import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Circle,
  CircleCheck,
  CircleHelp,
  CircleX,
  ExternalLink,
  MapPin,
  UserRound,
  Video,
} from 'lucide-react';
import { Button } from '../../components/ui';
import { calendar, type CalendarEvent } from '../agenda/calendar';
import { myResponse, type MyResponse } from './eventDetails';
import { Disclosure } from './Disclosure';
import { invitationText, shownLocation } from './invitationText';
import './signals.css';
import './meetingDetail.css';

const RESPONSE_ICONS: Record<MyResponse, ReactNode> = {
  organizer: <UserRound size={14} aria-hidden="true" />,
  accepted: <CircleCheck size={14} aria-hidden="true" />,
  tentative: <CircleHelp size={14} aria-hidden="true" />,
  declined: <CircleX size={14} aria-hidden="true" />,
  none: <Circle size={14} aria-hidden="true" />,
};

export const isJoinable = (event: CalendarEvent | null, ended: boolean) =>
  !!event?.joinUrl && !ended;

/**
 * The event's join and Outlook links (spec 0124 P2): they open by event id only.
 * Other actions of the head go between them, so the row reads main action first.
 */
export function EventLinks({
  event,
  ended,
  primary,
  children,
}: {
  event: CalendarEvent | null;
  ended: boolean;
  primary: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const k = (key: string) => t(`meetingsHub.eventDetails.${key}`);
  const [failed, setFailed] = useState(false);
  if (!event && !children) return null;
  const joinable = isJoinable(event, ended);
  const open = (link: 'join' | 'outlook') => {
    if (!event) return;
    setFailed(false);
    calendar.openLink(event.id, link).catch(() => setFailed(true));
  };
  return (
    <>
      <div className="ch-peek-primary">
        {joinable && (
          <Button
            variant={primary ? 'primary' : 'secondary'}
            icon={<Video size={15} aria-hidden="true" />}
            onClick={() => open('join')}
          >
            {k('join')}
          </Button>
        )}
        {children}
        {event &&
          (joinable || children ? (
            <Button
              variant="ghost"
              iconOnly
              icon={<ExternalLink size={15} aria-hidden="true" />}
              aria-label={k('openInOutlook')}
              title={k('openInOutlook')}
              onClick={() => open('outlook')}
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              icon={<ExternalLink size={14} aria-hidden="true" />}
              onClick={() => open('outlook')}
            >
              {k('openInOutlook')}
            </Button>
          ))}
      </div>
      {failed && (
        <p className="ch-peek-error" role="alert">
          {k('openFailed')}
        </p>
      )}
    </>
  );
}

/** My response, the place and who organizes it. Everything here is other people's text. */
export function EventFacts({ event, joinable }: { event: CalendarEvent; joinable: boolean }) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.eventDetails.${key}`, options);
  const response = myResponse(event);
  const location = shownLocation(event.location, joinable);
  const organizer = response !== 'organizer' ? event.organizer?.name : null;
  if (!response && !location && !organizer) return null;
  return (
    <ul className="ch-facts" aria-label={k('label')}>
      {response && (
        <li data-response={response}>
          {RESPONSE_ICONS[response]}
          <span>{k(`mine.${response}`)}</span>
        </li>
      )}
      {location && (
        <li>
          <MapPin size={14} aria-hidden="true" />
          <span>
            <span className="sr-only">{t('meetingDetail.facts.location')} </span>
            {location}
          </span>
        </li>
      )}
      {organizer && (
        <li>
          <UserRound size={14} aria-hidden="true" />
          <span>{t('meetingDetail.facts.organizer', { name: organizer })}</span>
        </li>
      )}
    </ul>
  );
}

/** What a person wrote in the invitation, never Teams' block (spec 0126 P4). */
export function EventInvitation({
  event,
  collapsed = false,
  headingClassName = 'ch-peek-h',
}: {
  event: CalendarEvent;
  collapsed?: boolean;
  headingClassName?: string;
}) {
  const { t } = useTranslation();
  const text = invitationText(event.bodyPreview);
  if (!text) return null;
  const preview = <p className="ch-event-preview">{text}</p>;
  if (collapsed)
    return (
      <Disclosure label={t('meetingDetail.invitation')} defaultOpen={false}>
        {preview}
      </Disclosure>
    );
  return (
    <section className="ch-peek-sec">
      <h3 className={headingClassName}>{t('meetingDetail.invitation')}</h3>
      {preview}
    </section>
  );
}
