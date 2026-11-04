import { useQuery } from '@tanstack/react-query';
import { library, type MeetingSignals } from '../meetings/library';
import { eventLook } from './eventDetailsModel';
import type { MeetingRow } from './meetingRows';

/**
 * Spec 0124 P4: the one way the UI reads what a meeting has. Shared by every
 * block on screen, so a poll is one backend call however many are visible.
 */
export const SIGNALS_KEY = ['meeting-signals'] as const;
const POLL_MS = 60_000;

export function useSignalsReport() {
  return useQuery({
    queryKey: SIGNALS_KEY,
    queryFn: () => library.signals(),
    enabled: library.available(),
    retry: false,
    refetchInterval: POLL_MS,
    staleTime: POLL_MS / 2,
  });
}

export function useSessionSignals(sessionId: string | null) {
  const report = useSignalsReport();
  return sessionId ? report.data?.sessions.find((s) => s.sessionId === sessionId) : undefined;
}

export const sessionIdOf = (row: MeetingRow) => (row.kind === 'session' ? row.session.id : null);

export type SignalItem =
  | {
      id:
        | 'useful'
        | 'notUseful'
        | 'transcript'
        | 'note'
        | 'preparation'
        | 'noPreparation'
        | 'diagram'
        | 'memory';
    }
  | { id: 'speakers'; named: number; unnamed: number }
  | { id: 'followUps'; linked: number; actions: number }
  | { id: 'files'; count: number };

/** A block that is not a meeting to prepare for never asks for preparation. */
export function lacksPreparation(
  row: MeetingRow,
  signals: MeetingSignals | undefined,
  now: Date
): boolean {
  if (row.kind === 'recording' || !row.start || row.start <= now) return false;
  const event = row.event;
  if (event) {
    if (event.allDay || event.cancelled || !event.attendees.length) return false;
    const look = eventLook(event);
    if (look === 'declined' || look === 'free') return false;
  }
  return row.kind === 'event' || (!!signals && !signals.preparation);
}

/** The owner's mark first, then in the order the question is usually asked. */
export function presentSignals(signals: MeetingSignals | undefined): SignalItem[] {
  if (!signals) return [];
  const items: SignalItem[] = [];
  if (signals.mark) items.push({ id: signals.mark });
  if (signals.transcript) items.push({ id: 'transcript' });
  if (signals.speakers.named + signals.speakers.unnamed > 0)
    items.push({ id: 'speakers', ...signals.speakers });
  if (signals.note) items.push({ id: 'note' });
  if (signals.preparation) items.push({ id: 'preparation' });
  if (signals.diagram) items.push({ id: 'diagram' });
  // A memory icon means a summary exists, and only that (P6).
  if (signals.summary) items.push({ id: 'memory' });
  if (signals.followUps.linked + signals.followUps.actions > 0)
    items.push({ id: 'followUps', ...signals.followUps });
  return items;
}

export function signalItems(
  row: MeetingRow,
  signals: MeetingSignals | undefined,
  now: Date
): SignalItem[] {
  const items = presentSignals(signals);
  return lacksPreparation(row, signals, now) ? [...items, { id: 'noPreparation' }] : items;
}
