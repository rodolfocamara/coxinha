import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Mic } from 'lucide-react';
import { Button } from '../../components/ui';
import { library, type CalendarMatch } from '../meetings/library';
import type { CalendarEvent } from '../agenda/calendar';
import { useCaptureStore } from '../capture/captureStore';
import { useEventColour } from '../agenda/categories';
import type { MeetingRow } from './meetingRows';
import { EventFacts, EventInvitation, EventLinks, isJoinable } from './EventDetails';
import { eventLook } from './eventDetails';
import { InviteeList } from './InviteeList';
import { panelState } from './meetingDetail';
import { PeekMeetingState } from './PeekMeetingState';
import { sessionIdOf, signalItems, useSessionSignals } from './meetingSignals';
import type { DetailPanel } from './meetingsSearch';
import { useMeetingActions } from './useMeetingActions';
import { useMeetingOutcome } from './useMeetingOutcome';
import { PeekOutcome, PeekPreparation, WhoCame } from './PeekSections';
import { PeekCalendarMatch } from './PeekCalendarMatch';
import { PeekHead } from './PeekHead';
import './calendarPeek.css';
import './meetingDetail.css';

type Props = {
  row: MeetingRow;
  now: Date;
  live: boolean;
  onClose: () => void;
  onOpen: (row: MeetingRow, panel?: DetailPanel) => void;
  onOpenSession: (sessionId: string) => void;
  /** The Outlook cache and the open proposals, to ask which event a recording is (spec 0111). */
  events?: CalendarEvent[];
  matches?: CalendarMatch[];
  onMatchResolved?: (kept?: string) => void;
  onMatchFocus?: (eventId: string | null) => void;
};

/**
 * A meeting as a reading panel (spec 0126): before it, how to join and who is
 * coming; after it, what came out. Escape closes it.
 */
export function MeetingPeek({
  row,
  now,
  live,
  onClose,
  onOpen,
  onOpenSession,
  events = [],
  matches = [],
  onMatchResolved = () => undefined,
  onMatchFocus,
}: Props) {
  const { t } = useTranslation();
  const k = (key: string) => t(`meetingsHub.home.${key}`);
  const heading = useRef<HTMLHeadingElement>(null);
  const session = row.kind === 'session' ? row.session : null;
  const event = row.kind === 'recording' ? null : row.event;
  const meetingId = session?.meeting_id ?? (row.kind === 'recording' ? row.recording.id : null);
  const colour = useEventColour(event);
  const capture = useCaptureStore((s) => s.status);
  const outcome = useMeetingOutcome(meetingId, session, row.start);
  const items = signalItems(row, useSessionSignals(sessionIdOf(row)), now);
  const count = outcome.files.length + outcome.references.length;
  const signals = count ? [...items, { id: 'files' as const, count }] : items;
  const detail = useQuery({
    queryKey: ['peek-detail', meetingId],
    queryFn: () => library.detail(meetingId!),
    enabled: !!meetingId && library.available(),
    retry: false,
  });
  const actions = useMeetingActions({
    session,
    event: row.kind === 'event' ? row.event : null,
    meetingId,
    onOpenSession,
    onChooseConfig: () => onOpen(row, 'transcript'),
    afterRecover: async () => undefined,
    afterProcess: () => undefined,
  });

  useEffect(() => {
    heading.current?.focus();
  }, [row.key]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      // Fields keep Escape for themselves (the search clears); dialogs and menus close first.
      if (target?.closest('input, textarea, select, [role="dialog"], [role="menu"]')) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const durationMs = detail.data?.storage?.durationMs ?? null;
  const state = panelState(row, now, !!meetingId);
  const past = state === 'past';
  const ended = !!row.end && row.end <= now;
  const joinable = isJoinable(event, ended);
  const canRecord =
    state === 'now' &&
    !live &&
    library.available() &&
    row.kind !== 'recording' &&
    !capture?.active &&
    !capture?.processing &&
    !meetingId;
  // A meeting the owner said no to asks nothing of them: its actions stay, unstressed.
  const quiet = !!event && (event.cancelled || eventLook(event) === 'declined');
  const leads = quiet ? null : joinable ? 'join' : canRecord ? 'record' : 'main';
  const mainInHead = past || (!joinable && !canRecord);
  const main =
    past || row.kind !== 'event' ? (
      <Button
        variant={leads === 'main' ? 'primary' : 'secondary'}
        size={mainInHead ? 'md' : 'sm'}
        onClick={() => onOpen(row)}
      >
        {k(past ? 'openMeeting' : 'prepare')}
      </Button>
    ) : (
      <Button
        variant={leads === 'main' ? 'primary' : 'secondary'}
        size={mainInHead ? 'md' : 'sm'}
        icon={<ClipboardList size={14} aria-hidden="true" />}
        disabled={actions.busy}
        onClick={actions.prepareNotes}
      >
        {k('prepare')}
      </Button>
    );

  return (
    <aside className="ch-peek" aria-labelledby="ch-peek-title">
      <PeekHead
        row={row}
        title={row.title || t('meetingsHub.untitled')}
        now={now}
        state={state}
        event={event}
        colour={colour}
        durationMs={durationMs}
        headingRef={heading}
        onClose={onClose}
      >
        <EventLinks event={event} ended={ended} primary={leads === 'join'}>
          {canRecord && (
            <Button
              variant={leads === 'record' ? 'primary' : 'secondary'}
              icon={<Mic size={14} aria-hidden="true" />}
              disabled={actions.busy}
              onClick={actions.record}
            >
              {k('record')}
            </Button>
          )}
          {mainInHead && main}
        </EventLinks>
        {actions.error && (
          <p className="ch-peek-error" role="alert">
            {actions.error}
          </p>
        )}
      </PeekHead>
      <div className="ch-peek-body">
        {past ? (
          <>
            <PeekOutcome
              outcome={outcome}
              signals={signals}
              onFull={() => onOpen(row, 'transcript')}
            />
            {session && meetingId && !event && row.start && (
              <PeekCalendarMatch
                key={session.id}
                sessionId={session.id}
                start={row.start}
                durationMs={durationMs}
                events={events}
                proposal={matches.find((m) => m.sessionId === session.id) ?? null}
                onResolved={onMatchResolved}
                onFocus={onMatchFocus}
              />
            )}
            <WhoCame meetingId={meetingId} />
            {event && <InviteeList event={event} past confirmed={outcome.confirmed} />}
            {session && <PeekMeetingState sessionId={session.id} />}
            {event && <EventFacts event={event} joinable={joinable} />}
            {event && <EventInvitation event={event} collapsed />}
          </>
        ) : (
          <>
            {event && <EventFacts event={event} joinable={joinable} />}
            {event && <InviteeList event={event} past={false} />}
            {event && !event.attendees.length && (
              <p className="ch-peek-note">{t('meetingDetail.noInvitees')}</p>
            )}
            <PeekPreparation
              outcome={outcome}
              signals={signals}
              prepare={mainInHead ? undefined : main}
            />
            {event && <EventInvitation event={event} />}
          </>
        )}
      </div>
    </aside>
  );
}
