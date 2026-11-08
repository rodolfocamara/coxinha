import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { initialCaptureState, useCaptureStore } from './captureStore';
import { toggleCapture } from './captureActions';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));

const sources = [
  { name: 'mic', monitor: false, is_default: true },
  { name: 'speakers', monitor: true, is_default: true },
];
let answers: Record<string, () => unknown>;
beforeEach(() => {
  useCaptureStore.setState({ ...initialCaptureState });
  answers = {
    library_sources: () => sources,
    library_create_session: () => ({ id: 'session' }),
    library_start_session: () => ({ active: { meetingId: 'meeting' }, error: null }),
    library_update_session: () => ({ id: 'session' }),
  };
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command) => {
      const answer = answers[command];
      if (!answer) throw new Error(`Unexpected ${command}`);
      return answer();
    });
});
const calls = (command: string) => vi.mocked(invoke).mock.calls.filter(([n]) => n === command);

it('says recording is unsupported and creates no meeting where the OS has no adapter', async () => {
  answers.library_sources = () => {
    throw 'capture adapter unavailable on this platform';
  };
  expect(await toggleCapture('Recording')).toBeNull();
  expect(useCaptureStore.getState().failure).toBe('unsupported');
  expect(calls('library_create_session')).toHaveLength(0);
});

it('creates no meeting when a device is missing', async () => {
  answers.library_sources = () => [sources[1]];
  expect(await toggleCapture('Recording')).toBeNull();
  expect(useCaptureStore.getState().failure).toBe('devicesMissing');
  expect(calls('library_create_session')).toHaveLength(0);
});

it('cancels the meeting it created when the start fails', async () => {
  answers.library_start_session = () => {
    throw new Error('device busy');
  };
  expect(await toggleCapture('Recording')).toBeNull();
  expect(useCaptureStore.getState().failure).toBe('start');
  const [[, args]] = calls('library_update_session');
  expect(args).toMatchObject({ sessionId: 'session', input: { status: 'cancelled' } });
});

it('keeps the meeting active when the capture starts', async () => {
  expect((await toggleCapture('Recording'))?.active).toBeTruthy();
  expect(calls('library_create_session')).toHaveLength(1);
  expect(calls('library_update_session')).toHaveLength(0);
});

it('a second press while the first is still checking devices creates no second meeting', async () => {
  const [first, second] = await Promise.all([
    toggleCapture('Recording'),
    toggleCapture('Recording'),
  ]);
  expect(first?.active).toBeTruthy();
  expect(second).toBeNull();
  expect(calls('library_create_session')).toHaveLength(1);
});
