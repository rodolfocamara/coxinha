import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Circle,
  CircleCheck,
  CircleHelp,
  CircleX,
  ExternalLink,
  Mail,
  MapPin,
  UserRound,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '../../components/ui';
import { calendar, type CalendarEvent } from '../agenda/calendar';
import { myResponse, type MyResponse } from './eventDetailsModel';
import { invitationText, shownLocation } from './invitationText';
import { PropDisclosure, PropRow } from './PropertySheet';
import './signals.css';
import './meetingDetail.css';

const RESPONSE_ICONS: Record<MyResponse, LucideIcon> = {
  organizer: UserRound,
  accepted: CircleCheck,
  tentative: CircleHelp,
  declined: CircleX,
  none: Circle,
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

/** My response, the place and who organizes it, as rows. Everything here is other people's text. */
export function EventRows({
  event,
  hidePlaceholder,
}: {
  event: CalendarEvent;
  /** Beside a join button, or once it is over, Teams' placeholder says nothing. */
  hidePlaceholder: boolean;
}) {
  const { t } = useTranslation();
  const r = (key: string) => t(`meetingDetail.rows.${key}`);
  const response = myResponse(event);
  const location = shownLocation(event.location, hidePlaceholder);
  const organizer = response !== 'organizer' ? event.organizer?.name : null;
  return (
    <>
      {response && (
        <PropRow icon={RESPONSE_ICONS[response]} label={r('response')} tone={response}>
          {t(`meetingDetail.values.response.${response}`)}
        </PropRow>
      )}
      {location && (
        <PropRow icon={MapPin} label={r('location')}>
          {location}
        </PropRow>
      )}
      {organizer && (
        <PropRow icon={UserRound} label={r('organizer')}>
          {organizer}
        </PropRow>
      )}
    </>
  );
}

/** What a person wrote in the invitation, never Teams' block (spec 0126 P4). */
export function InvitationRow({ event }: { event: CalendarEvent }) {
  const { t } = useTranslation();
  const text = invitationText(event.bodyPreview);
  if (!text) return null;
  return (
    <PropDisclosure
      icon={Mail}
      label={t('meetingDetail.rows.invitation')}
      summary={t('meetingDetail.values.showMessage')}
    >
      <p className="ch-event-preview">{text}</p>
    </PropDisclosure>
  );
}
