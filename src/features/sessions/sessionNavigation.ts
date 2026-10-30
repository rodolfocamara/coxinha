import { create } from 'zustand';
import type { Session } from './sessions';
import { monthStart, type Period } from './sessionDates';

export type TranscriptFilter = 'all' | 'available' | 'without';
export function transcriptStatus(session: Session) {
  const status = session.transcript_status;
  return status === 'available' ||
    status === 'none' ||
    status === 'empty' ||
    status === 'unavailable'
    ? status
    : 'unknown';
}
export function matchesTranscript(session: Session, filter: TranscriptFilter) {
  const status = transcriptStatus(session);
  return (
    filter === 'all' ||
    (filter === 'available' ? status === 'available' : status === 'none' || status === 'empty')
  );
}
/** Independent sidebar/calendar filters. Route changes never write either filter. No disk persistence. */
export const useSessionNavigation = create<{
  sidebarPeriod: Period;
  calendarPeriod: Period;
  transcript: TranscriptFilter;
  month: Date;
  selectedDay: string | null;
  view: 'month' | 'list';
}>(() => ({
  sidebarPeriod: { kind: 'all' },
  calendarPeriod: { kind: 'all' },
  transcript: 'all',
  month: monthStart(new Date()),
  selectedDay: null,
  view: 'month',
}));
