import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { library } from '../meetings/library';
import { sessions } from '../sessions/sessions';
import { sessionCaptureCache } from '../sessions/sessionCapture';
import { acceptDetectionStatus, callKey, useMeetingDetection } from './meetingDetection';
import { invitedPeople, recordDetectedCall, useDirectCapture } from './directCapture';
import { nearbyInvitations } from './MeetingDetails';
import type { ActiveCall } from '../../lib/bindings';
import type { CalendarEvent } from '../agenda/calendar';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
const call: ActiveCall = {
  app_name: 'Teams',
  process_name: 'teams',
  pid: 42,
  is_browser: false,
  detected_at: '2026-10-26T12:00:00Z',
};
const status = { enabled: true, supported: true, unavailable: false, calls: [call] };
const event: CalendarEvent = {
  id: 'event',
  title: 'Planning',
  startsAt: '2026-10-26T12:00:00Z',
  endsAt: '2026-10-26T13:00:00Z',
  cancelled: false,
  allDay: false,
  attendees: [{ name: 'A', email: 'a@example.test' }],
  organizer: { name: 'A', email: 'A@example.test' },
};
const active = { active: { meetingId: 'meeting' } };
beforeEach(() => {
  vi.restoreAllMocks();
  useMeetingDetection.setState({ enabled: true, dismissed: [] });
  acceptDetectionStatus(status, false);
  useDirectCapture.setState({ busy: false, attempt: null, error: null, receipt: null });
  sessionCaptureCache.setState({ bySession: new Map() });
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command) => {
      if (command === 'library_status') return { active: null };
      if (command === 'library_sources')
        return [
          { name: 'wrong', monitor: false },
          { name: 'default-mic', monitor: false, is_default: true },
          { name: 'default-output', monitor: true, is_default: true },
        ];
      if (command === 'library_create_session') return { id: 'session' };
      if (command === 'library_start_session') return active;
      if (command === 'library_set_participant_context') return [];
      throw new Error(`Unexpected ${command}`);
    });
});
function count(command: string) {
  return vi.mocked(invoke).mock.calls.filter(([name]) => name === command).length;
}
it('single-flight survives remount/store reads and retains the acknowledged owner', async () => {
  let resolve!: (value: typeof active) => void;
  const start = vi.fn(
    () =>
      new Promise<typeof active>((done) => {
        resolve = done;
      })
  );
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, args) =>
    command === 'library_start_session' ? (start() as never) : implementation(command, args)
  );
  const pending = recordDetectedCall(call, 'Teams meeting');
  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  await recordDetectedCall(call, 'Changed during remount');
  expect(count('library_create_session')).toBe(1);
  resolve(active);
  await pending;
  expect(start).toHaveBeenCalledOnce();
  expect(sessionCaptureCache.getState().bySession.get('session')).toBe('meeting');
  await recordDetectedCall(call, 'Again');
  expect(start).toHaveBeenCalledOnce();
});
it('failed start reuses its session on an explicit retry and establishes no owner early', async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  let fails = true;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'library_start_session' && fails) throw new Error('device unavailable');
    return original(command, args);
  });
  await recordDetectedCall(call, 'Original');
  expect(useDirectCapture.getState().error).toBe('startFailed');
  expect(sessionCaptureCache.getState().bySession.size).toBe(0);
  fails = false;
  await recordDetectedCall(call, 'Changed');
  expect(count('library_create_session')).toBe(1);
  expect(count('library_start_session')).toBe(2);
  expect(useDirectCapture.getState().receipt?.title).toBe('Original');
});
it('does not guess missing defaults or create a session', async () => {
  vi.spyOn(library, 'sources').mockResolvedValue([
    { name: 'not-default', description: 'Other microphone', monitor: false },
  ]);
  await recordDetectedCall(call, 'Title');
  expect(useDirectCapture.getState().error).toBe('devicesMissing');
  expect(count('library_start_session')).toBe(0);
  expect(count('library_create_session')).toBe(0);
});
it.each(['ended', 'disabled'])(
  'rechecks %s call after creation before starting',
  async (reason) => {
    vi.spyOn(sessions, 'create').mockImplementation(async () => {
      if (reason === 'ended') acceptDetectionStatus({ ...status, calls: [] }, false);
      else useMeetingDetection.setState({ enabled: false });
      return { id: 'session' } as never;
    });
    await recordDetectedCall(call, 'Title');
    expect(count('library_start_session')).toBe(0);
    expect(useDirectCapture.getState().error).toBe('callEnded');
  }
);
it('active foreign recording and failed status cannot cause a new capture', async () => {
  vi.spyOn(library, 'status').mockResolvedValue(active as never);
  await recordDetectedCall(call, 'Title');
  expect(useDirectCapture.getState().error).toBe('captureBusy');
  vi.spyOn(library, 'status').mockRejectedValue(new Error('offline'));
  await recordDetectedCall(call, 'Title');
  expect(count('library_create_session')).toBe(0);
  expect(count('library_start_session')).toBe(0);
});
it('metadata failure after acknowledgement cannot repeat capture or erase ownership', async () => {
  vi.spyOn(library, 'setParticipantContext').mockRejectedValue(new Error('metadata unavailable'));
  await recordDetectedCall(call, 'Title', event);
  expect(useDirectCapture.getState().receipt).toEqual({
    sessionId: 'session',
    title: 'Planning',
    metadataFailed: true,
  });
  expect(library.setParticipantContext).toHaveBeenCalledWith('meeting', [
    { name: 'A', email: 'a@example.test' },
  ]);
  expect(invoke).toHaveBeenCalledWith('library_create_session', {
    input: {
      title: 'Planning',
      starts_at: event.startsAt,
      ends_at: event.endsAt,
      status: 'planned',
    },
  });
  await recordDetectedCall(call, 'Again');
  expect(count('library_start_session')).toBe(1);
  expect(sessionCaptureCache.getState().bySession.get('session')).toBe('meeting');
  expect(useMeetingDetection.getState().dismissed).toContain(callKey(call));
});
it('offers cached invitations without automatically choosing an ambiguous event', () => {
  expect(
    nearbyInvitations(
      [
        event,
        { ...event, id: 'other' },
        { ...event, id: 'cancelled', cancelled: true },
        { ...event, id: 'all-day', allDay: true },
        { ...event, id: 'invalid', startsAt: 'bad' },
      ],
      Date.parse('2026-10-26T12:01:00Z')
    ).map((e) => e.id)
  ).toEqual(['event', 'other']);
  expect(invitedPeople(event)).toHaveLength(1);
});
