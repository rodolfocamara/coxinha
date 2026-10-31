/**
 * Shared backend double for the Reuniões screen tests. Each test file mocks
 * Tauri, the root layout, the note editor and the processing panel itself
 * (vi.mock is hoisted per file) and installs `backend.invoke`.
 */
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { createAppRouter } from '../../router';
import type { Session } from '../sessions/sessions';
import type { CalendarEvent } from '../agenda/calendar';
import type { LibraryDetail, LibraryMeeting, ProcessingDetail } from '../meetings/library';
import { at, recording, session } from './meetingsHub.fixtures';

export * from './meetingsHub.fixtures';
import { sessionListCache } from '../sessions/sessions';
import { initialCaptureState, useCaptureStore } from '../capture/captureStore';
import { forgetProcessingConfig } from '../meetings/processingConfigMemory';
import { takePendingSheet } from './meetingsSheets';

export type Db = {
  sessions: Session[];
  events: CalendarEvent[];
  account: string | null;
  recordings: LibraryMeeting[];
  processing: Record<string, ProcessingDetail>;
  contexts: Record<string, { name: string; email: string | null }[]>;
  failSessions: number;
  failImport: boolean;
  failUpdate: boolean;
  calls: { command: string; args: Record<string, unknown> }[];
};

export function freshDb(): Db {
  return {
    sessions: [],
    events: [],
    account: null,
    recordings: [],
    processing: {},
    contexts: {},
    failSessions: 0,
    failImport: false,
    failUpdate: false,
    calls: [],
  };
}

const detailOf = (db: Db, meetingId: string): LibraryDetail => {
  const meeting =
    db.recordings.find((r) => r.id === meetingId) ??
    db.sessions.find((s) => s.recording?.id === meetingId)?.recording ??
    recording(meetingId, 'Recording');
  return {
    meeting,
    storage: {
      directory: `/vault/recordings/${meetingId}`,
      totalBytes: 1,
      durationMs: 600_000,
      files: [],
    },
    manifest: null,
    audio: null,
    inference: 'local',
  };
};

const status = (meetingId: string | null) => ({
  active: meetingId
    ? {
        meetingId,
        paused: false,
        elapsedMs: 1000,
        mic: { peak: 0, lastBlockMs: null, error: null },
        output: { peak: 0, lastBlockMs: null, error: null },
      }
    : null,
  error: null,
});

export function backend(db: Db) {
  return async (command: string, raw?: unknown) => {
    const args = (raw ?? {}) as Record<string, unknown>;
    db.calls.push({ command, args });
    switch (command) {
      case 'library_sessions':
        if (db.failSessions > 0) {
          db.failSessions--;
          throw new Error('sessions unavailable');
        }
        return db.sessions;
      case 'library_session': {
        const found = db.sessions.find((s) => s.id === args.sessionId);
        if (!found) throw new Error('session not found');
        return found;
      }
      case 'library_list':
        return db.recordings;
      case 'calendar_status':
        return { account: db.account, syncedAt: db.account ? at(0, 8) : null, events: db.events };
      case 'library_detail':
        return detailOf(db, String(args.meetingId));
      case 'library_recover': {
        const id = String(args.meetingId);
        db.sessions = db.sessions.map((s) =>
          s.recording?.id === id
            ? { ...s, recording: { ...s.recording, captureState: 'finished' } }
            : s
        );
        db.recordings = db.recordings.map((r) =>
          r.id === id ? { ...r, captureState: 'finished' } : r
        );
        return detailOf(db, id);
      }
      case 'library_processing':
        return db.processing[String(args.meetingId)] ?? { jobs: [], report: null, people: [] };
      case 'library_process':
        return {
          active: null,
          error: null,
          processing: { meetingId: args.meetingId, job: 'j2', phase: 'queued' },
        };
      case 'library_participant_context':
        return db.contexts[String(args.meetingId)] ?? [];
      case 'library_set_participant_context':
        db.contexts[String(args.meetingId)] = args.participants as Db['contexts'][string];
        return args.participants;
      case 'library_sources':
        return [
          { name: 'mic', description: 'Microphone', monitor: false, is_default: true },
          { name: 'out.monitor', description: 'Speakers', monitor: true, is_default: true },
        ];
      case 'library_start_session': {
        const id = `m-${String(args.sessionId)}`;
        db.sessions = db.sessions.map((s) =>
          s.id === args.sessionId
            ? { ...s, meeting_id: id, recording: recording(id, s.title, 'recording') }
            : s
        );
        return status(id);
      }
      case 'library_create_session': {
        const input = args.input as Session;
        const created = session({ ...input, id: `s-new-${db.sessions.length}` });
        db.sessions = [...db.sessions, created];
        return created;
      }
      case 'library_update_session': {
        if (db.failUpdate) throw new Error('update failed');
        db.sessions = db.sessions.map((s) =>
          s.id === args.sessionId ? { ...s, ...(args.input as object) } : s
        );
        return db.sessions.find((s) => s.id === args.sessionId);
      }
      case 'library_ensure_personal_note':
        return {
          ...db.sessions.find((s) => s.id === args.sessionId),
          personal_note: { id: 'n1', relative_path: 'meetings/n1.md' },
        };
      case 'get_note':
        return { note: { id: 'n1', title: 'Notes', tags: [] }, markdown: 'Agenda text' };
      case 'library_import_audio': {
        if (db.failImport) throw new Error('not a WAV file');
        const imported = recording('m-imported', String(args.title), 'finished', at(0, 9));
        db.recordings = [...db.recordings, imported];
        return { ...detailOf(db, imported.id), audio: null };
      }
      default:
        throw new Error(`Unexpected command ${command}`);
    }
  };
}

export function resetState() {
  sessionListCache.setState({ data: undefined, isError: false, updatedAt: 0 });
  useCaptureStore.setState({ ...initialCaptureState });
  forgetProcessingConfig();
  takePendingSheet();
}

export function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(client);
  router.history.push(path);
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

export const calledWith = (db: Db, command: string) =>
  db.calls.filter((c) => c.command === command).map((c) => c.args);
