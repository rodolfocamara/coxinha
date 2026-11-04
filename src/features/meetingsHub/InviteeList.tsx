import { useTranslation } from 'react-i18next';
import { Check, UsersRound } from 'lucide-react';
import type { AttendeeResponse, CalendarEvent } from '../agenda/calendar';
import { attendeeGroups } from './eventDetailsModel';
import { Disclosure } from './Disclosure';
import { groupStartsOpen } from './meetingDetailModel';
import { normalize } from './meetingRows';
import { PersonAvatar } from './PersonAvatar';
import { PropDisclosure, PropRow } from './PropertySheet';
import './meetingPeople.css';

const FLAT_ROWS = 6;
const STACK = 4;

function AvatarStack({ people }: { people: { name: string; email?: string | null }[] }) {
  const { t } = useTranslation();
  const more = people.length - STACK;
  return (
    <span className="ch-av-stack" aria-hidden="true">
      {people.slice(0, STACK).map((person, i) => (
        <PersonAvatar key={i} name={person.name || person.email || ''} />
      ))}
      {more > 0 && (
        <span className="ch-av-more">{t('meetingDetail.people.stackMore', { count: more })}</span>
      )}
    </span>
  );
}

/**
 * Spec 0126 P9: invitees as a row that sums them up, by response, with the list
 * collapsed at every size. Names come from other people and stay text.
 * `confirmed` marks who is known to have spoken.
 */
export function InviteesRow({
  event,
  past,
  confirmed = [],
}: {
  event: CalendarEvent;
  past: boolean;
  confirmed?: string[];
}) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingDetail.people.${key}`, options);
  const label = t('meetingDetail.rows.invited');
  const invitees = attendeeGroups(event);
  const spoke = new Set(confirmed.map(normalize));
  if (!invitees) {
    if (!event.attendees.length)
      return (
        <PropRow icon={UsersRound} label={label} quiet>
          {t('meetingDetail.values.nobodyInvited')}
        </PropRow>
      );
    const extra = event.attendees.length - FLAT_ROWS;
    return (
      <PropDisclosure
        icon={UsersRound}
        label={label}
        summary={
          <span className="ch-prop-invited">
            <AvatarStack people={event.attendees} />
            {t('meetingsHub.calendarMatch.invitees', { count: event.attendees.length })}
          </span>
        }
      >
        <ul className="ch-people">
          {event.attendees.slice(0, FLAT_ROWS).map((person, i) => (
            <PersonRow
              key={`${person.email ?? person.name}-${i}`}
              name={person.name || person.email || ''}
            />
          ))}
        </ul>
        {extra > 0 && <p className="ch-peek-note">{k('more', { count: extra })}</p>}
      </PropDisclosure>
    );
  }
  if (!invitees.total)
    return (
      <PropRow icon={UsersRound} label={label} quiet>
        {t('meetingDetail.values.nobodyInvited')}
      </PropRow>
    );
  return (
    <PropDisclosure
      icon={UsersRound}
      label={label}
      summary={
        <span className="ch-prop-invited">
          <AvatarStack people={invitees.groups.flatMap((group) => group.people)} />
          <span className="ch-prop-counts">
            {invitees.groups.map((group) => (
              <span key={group.id} className="ch-prop-count">
                <i className="ch-group-dot" data-group={group.id} aria-hidden="true" />
                {k(`response.${group.id}`, { count: group.people.length })}
              </span>
            ))}
          </span>
          <span className="ch-tally" aria-hidden="true">
            {invitees.groups.map((group) => (
              <i key={group.id} data-group={group.id} style={{ flexGrow: group.people.length }} />
            ))}
          </span>
        </span>
      }
    >
      {invitees.groups.map((group) => (
        <Disclosure
          key={group.id}
          defaultOpen={groupStartsOpen(group.id, group.people.length, invitees.total, past)}
          label={
            <>
              <i className="ch-group-dot" data-group={group.id} aria-hidden="true" />
              {t(`meetingsHub.eventDetails.group.${group.id}`, { count: group.people.length })}
            </>
          }
          trailing={
            <span className="ch-av-stack" aria-hidden="true">
              {group.people.slice(0, STACK).map((person, i) => (
                <PersonAvatar key={i} name={person.name || person.email || ''} />
              ))}
            </span>
          }
        >
          <ul className="ch-people">
            {group.people.map((person, i) => (
              <PersonRow
                key={`${person.email ?? person.name}-${i}`}
                name={person.name || person.email || ''}
                role={roleOf(person)}
                spoke={spoke.has(normalize(person.name))}
              />
            ))}
          </ul>
        </Disclosure>
      ))}
    </PropDisclosure>
  );
}

/** Only the exception: on a list where nearly everyone is required, the word says nothing. */
const roleOf = (person: AttendeeResponse) =>
  person.response === 'organizer' ? 'organizer' : person.kind === 'optional' ? 'optional' : null;

export function PersonRow({
  name,
  role,
  spoke = false,
}: {
  name: string;
  role?: 'organizer' | 'optional' | null;
  spoke?: boolean;
}) {
  const { t } = useTranslation();
  const k = (key: string) => t(`meetingDetail.people.${key}`);
  return (
    <li className="ch-person">
      <PersonAvatar name={name} />
      <span className="ch-person-name">
        {name}
        {spoke && (
          <span className="ch-person-spoke" title={k('spoke')}>
            <Check size={12} aria-hidden="true" />
            <span className="sr-only">{k('spoke')}</span>
          </span>
        )}
      </span>
      {role && <span className="ch-person-role">{k(role)}</span>}
    </li>
  );
}
