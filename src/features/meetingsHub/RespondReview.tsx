import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui';
import type { CalendarEvent, ResponseRequest } from '../agenda/calendar';
import { whenLabel } from './format';
import { isRecurring, organizerName, ownerZone } from './respondModel';

/** Step two of spec 0130 P4: who receives what, before the only button that sends. */
export function RespondReview({
  event,
  request,
  when,
  error,
}: {
  event: CalendarEvent;
  request: ResponseRequest;
  when: string;
  error: string | null;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingDetail.respond.${key}`, options);
  const heading = useRef<HTMLParagraphElement>(null);
  const name = organizerName(event);
  const email = event.organizer?.email;
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const slot = request.proposed;
  const response = slot ? k(`review.${request.kind}NewTime`) : k(`choice.${request.kind}`);
  const applies = !isRecurring(event)
    ? k('scope.single')
    : request.scope === 'series'
      ? k('scope.series')
      : k('scope.occurrence', { when });
  return (
    <div className="ch-respond">
      <p ref={heading} tabIndex={-1} className="ch-respond-claim">
        {request.notify ? k('review.willSend', { name }) : k('review.silent')}
      </p>
      <dl className="ch-respond-review">
        <dt>{k('review.to')}</dt>
        <dd>
          {request.notify ? (
            <>
              {name}
              {email && email !== name && <small>{email}</small>}
            </>
          ) : (
            k('review.nobody')
          )}
        </dd>
        <dt>{k('review.event')}</dt>
        <dd>{event.title}</dd>
        <dt>{k('review.response')}</dt>
        <dd>{response}</dd>
        {request.comment && (
          <>
            <dt>{k('review.comment')}</dt>
            <dd className="ch-respond-comment">{request.comment}</dd>
          </>
        )}
        {slot && (
          <>
            <dt>{k('review.proposed')}</dt>
            <dd>
              {whenLabel(new Date(slot.startsAt), new Date(slot.endsAt), new Date(), locale, t)}
              <small>{ownerZone(new Date(slot.startsAt), locale)}</small>
            </dd>
          </>
        )}
        <dt>{k('review.appliesTo')}</dt>
        <dd>{applies}</dd>
      </dl>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
