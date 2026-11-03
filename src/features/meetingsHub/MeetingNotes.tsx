import type { ComponentProps } from 'react';
import { SessionNotes } from '../sessions/SessionNotes';
import type { Session } from '../sessions/sessions';
import { NotesPlaceholder } from './DetailPlaceholders';
import { SummaryBlock } from './SummaryBlock';

/** Notas tab: the generated summary (spec 0108) above the owner's own notes. */
export function MeetingNotes({
  session,
  meetingId,
  ...placeholder
}: { session: Session | null | undefined; meetingId: string | null | undefined } & ComponentProps<
  typeof NotesPlaceholder
>) {
  return (
    <>
      {meetingId && <SummaryBlock meetingId={meetingId} />}
      {session ? <SessionNotes sessionId={session.id} /> : <NotesPlaceholder {...placeholder} />}
    </>
  );
}
