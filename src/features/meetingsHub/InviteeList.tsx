import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { AttendeeResponse, CalendarEvent } from '../agenda/calendar';
import { attendeeGroups } from './eventDetails';
import { Disclosure } from './Disclosure';
import { groupStartsOpen } from './meetingDetail';
import { normalize } from './meetingRows';
import { PersonAvatar } from './PersonAvatar';
import './meetingPeople.css';

const FLAT_ROWS = 6;
const STACK = 4;

/**
 * Spec 0126 P3: invitees as a list to scan, by response. Names come from other
 * people and stay text. `confirmed` marks who is known to have spoken.
 */
export function InviteeList({
  event,
  past,
  confirmed = [],
  headingClassName = 'ch-peek-h',
}: {
  event: CalendarEvent;
  past: boolean;
  confirmed?: string[];
  headingClassName?: string;
}) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingDetail.people.${key}`, options);
  const invitees = attendeeGroups(event);
  const spoke = new Set(confirmed.map(normalize));
  if (!invitees) {
    if (!event.attendees.length) return null;
    const extra = event.attendees.length - FLAT_ROWS;
    return (
      <section className="ch-peek-sec">
        <h3 className={headingClassName}>{t('meetingsHub.home.invitees')}</h3>
        <ul className="ch-people">
          {event.attendees.slice(0, FLAT_ROWS).map((person, i) => (
            <PersonRow
              key={`${person.email ?? person.name}-${i}`}
              name={person.name || person.email || ''}
            />
          ))}
        </ul>
        {extra > 0 && <p className="ch-peek-note">{k('more', { count: extra })}</p>}
      </section>
    );
  }
  if (!invitees.total) return null;
  return (
    <section className="ch-peek-sec">
      <h3 className={headingClassName}>{k(past ? 'invited' : 'coming')}</h3>
      <p className="ch-peek-note">
        {k('counts', {
          count: invitees.total,
          required: invitees.required,
          optional: invitees.optional,
        })}
      </p>
      <div className="ch-tally" aria-hidden="true">
        {invitees.groups.map((group) => (
          <i key={group.id} data-group={group.id} style={{ flexGrow: group.people.length }} />
        ))}
      </div>
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
    </section>
  );
}

const roleOf = (person: AttendeeResponse) =>
  person.response === 'organizer' ? 'organizer' : (person.kind ?? null);

export function PersonRow({
  name,
  role,
  spoke = false,
}: {
  name: string;
  role?: 'organizer' | 'required' | 'optional' | 'resource' | null;
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
      {role && role !== 'resource' && <span className="ch-person-role">{k(role)}</span>}
    </li>
  );
}
