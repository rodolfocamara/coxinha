import { useState } from 'react';
import { library } from '../meetings/library';
import { recalledProcessingConfig } from '../meetings/processingConfigMemory';
import { refreshSessionList, sessions, type Session } from '../sessions/sessions';
import { startCapture } from '../capture/captureActions';
import { useCaptureStore } from '../capture/captureStore';
import type { CalendarEvent } from '../agenda/calendar';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Creates the meeting session for an Outlook event: title, times and nothing else. */
export function createSessionFromEvent(event: CalendarEvent) {
  return sessions.create({
    title: event.title,
    starts_at: event.startsAt,
    ends_at: event.endsAt,
    status: 'planned',
  });
}

/**
 * Actions offered by meeting detail. Capture only starts through
 * `startCapture`; transcription repeats the configuration chosen earlier in
 * this run, otherwise it sends the user to the transcript tab to pick one.
 */
export function useMeetingActions({
  session,
  event,
  meetingId,
  onOpenSession,
  onChooseConfig,
  afterRecover,
  afterProcess,
}: {
  session: Session | null;
  event: CalendarEvent | null;
  meetingId: string | null;
  onOpenSession: (sessionId: string) => void;
  onChooseConfig: () => void;
  afterRecover: (detail: Awaited<ReturnType<typeof library.recover>>) => Promise<void>;
  afterProcess: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return {
    busy,
    error,
    clearError: () => setError(null),
    record: () =>
      run(async () => {
        if (session) {
          await startCapture({ sessionId: session.id, title: session.title });
          return;
        }
        if (!event) return;
        const created = await createSessionFromEvent(event);
        await refreshSessionList();
        const status = await startCapture({ sessionId: created.id, title: created.title });
        // Same seeding as a detected call: invitees become speaker candidates.
        if (status?.active && event.attendees.length)
          await library
            .setParticipantContext(status.active.meetingId, event.attendees.slice(0, 100))
            .catch(() => undefined);
        onOpenSession(created.id);
      }),
    prepareNotes: () =>
      run(async () => {
        if (!event) return;
        const created = await createSessionFromEvent(event);
        await refreshSessionList();
        onOpenSession(created.id);
      }),
    recover: () =>
      run(async () => {
        if (!meetingId) return;
        await afterRecover(await library.recover(meetingId));
      }),
    transcribe: () => {
      const config = recalledProcessingConfig();
      if (!config || !meetingId) {
        onChooseConfig();
        return;
      }
      void run(async () => {
        useCaptureStore.setState({ status: await library.process(meetingId, config) });
        afterProcess();
      });
    },
  };
}
