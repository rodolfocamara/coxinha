import { useEffect, useState } from 'react';
import { calendar, type CalendarEvent } from '../agenda/calendar';
import { matchEvent } from '../meetingsHub/meetingRows';
import { sessions } from '../sessions/sessions';
import { nearbyInvitations } from './MeetingDetails';

/**
 * The calendar meeting a call most likely is (spec 0113): one already under
 * way before one about to start, then the nearest start, then one with
 * invitees over a personal block. Still a suggestion the owner can change.
 */
export function likelyInvitation(events: CalendarEvent[], now = Date.now()) {
  const rank = (e: CalendarEvent) => {
    const start = Date.parse(e.startsAt);
    return [start <= now ? 0 : 1, Math.abs(start - now), e.attendees.length ? 0 : 1];
  };
  return [...nearbyInvitations(events ?? [], now)].sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return x[0] - y[0] || x[2] - y[2] || x[1] - y[1];
  })[0];
}

/** Nearby calendar meetings and the likely one, read once when a call shows up. */
export function useInvitations() {
  const [state, setState] = useState<{
    events: CalendarEvent[];
    likely?: CalendarEvent;
    ready: boolean;
  }>({ events: [], ready: false });
  useEffect(() => {
    let live = true;
    void calendar
      .status()
      .then((snapshot) => {
        if (!live) return;
        const events = snapshot.account ? nearbyInvitations(snapshot.events) : [];
        setState({ events, likely: likelyInvitation(events), ready: true });
      })
      .catch(() => live && setState({ events: [], ready: true }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** A session prepared from this event and not recorded yet, to record into instead of a new one. */
export async function preparedSession(event: CalendarEvent): Promise<string | null> {
  try {
    const list = await sessions.list();
    return (
      list.find((s) => !s.meeting_id && s.status === 'planned' && matchEvent(s, [event]))?.id ??
      null
    );
  } catch {
    return null;
  }
}
