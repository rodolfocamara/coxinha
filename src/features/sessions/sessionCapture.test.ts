import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { sessionCaptureCache, startSessionCapture } from './sessionCapture';
import type { CaptureStatus } from '../meetings/library';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  sessionCaptureCache.setState({ bySession: new Map() });
});
it('retains separate successful acknowledgements and preserves them when another explicit start rejects', async () => {
  const status = (meetingId: string) => ({ active: { meetingId }, error: null }) as CaptureStatus;
  vi.mocked(invoke).mockResolvedValueOnce(status('m1')).mockResolvedValueOnce(status('m2'));
  await startSessionCapture('s1', 'mic', 'output');
  await startSessionCapture('s2', 'mic', 'output');
  expect([...sessionCaptureCache.getState().bySession]).toEqual([
    ['s1', 'm1'],
    ['s2', 'm2'],
  ]);
  vi.mocked(invoke).mockRejectedValueOnce(new Error('already recorded'));
  await expect(startSessionCapture('s1', 'mic', 'output')).rejects.toThrow('already recorded');
  expect([...sessionCaptureCache.getState().bySession]).toEqual([
    ['s1', 'm1'],
    ['s2', 'm2'],
  ]);
  expect(invoke).toHaveBeenCalledWith('library_start_session', {
    sessionId: 's1',
    micSource: 'mic',
    outputSource: 'output',
  });
});
it('does not create an acknowledgement for a successful response without an active capture', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ active: null, error: null });
  await startSessionCapture('s1', 'mic', 'output');
  expect(sessionCaptureCache.getState().bySession.size).toBe(0);
});
