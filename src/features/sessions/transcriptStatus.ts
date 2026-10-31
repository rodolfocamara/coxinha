import type { Session } from './sessions';

export type TranscriptFilter = 'all' | 'available' | 'without';

/** Saved transcript coverage. A generic job state never implies coverage. */
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
