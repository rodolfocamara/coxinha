import type { Session } from './sessions';

/** Synthetic public fixture, never loaded into the desktop vault. */
export function calendarSession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    title: `Meeting ${id}`,
    starts_at: null,
    ends_at: null,
    status: 'planned',
    origin: 'manual',
    meeting_id: null,
    personal_note: null,
    created_at: '2026-10-25T15:00:00Z',
    note_error: null,
    recording: null,
    ...overrides,
  };
}
