import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { library } from './library';
import { selectDevice, useCaptureDevices } from './useCaptureDevices';
vi.mock('./library', () => ({ library: { sources: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const sources = [
  { name: 'webcam', description: 'Webcam', monitor: false },
  { name: 'vocaster', description: 'Vocaster', monitor: false, is_default: true },
  { name: 'headphones-monitor', description: 'Headphones', monitor: true, is_default: true },
];
it('selects the server defaults without using first device or aliases', () => {
  expect(selectDevice(sources, '', false)).toBe('vocaster');
  expect(selectDevice(sources, '', true)).toBe('headphones-monitor');
  expect(selectDevice(sources.slice(0, 1), '', false)).toBe('');
  expect(selectDevice(sources, 'headphones-monitor', false)).toBe('vocaster');
});
it('preserves manual selection on refresh, resets explicitly and recovers missing devices', async () => {
  vi.mocked(library.sources).mockResolvedValue(sources);
  const { result } = renderHook(useCaptureDevices);
  await act(() => result.current.refreshSources());
  expect(result.current.mic).toBe('vocaster');
  expect(result.current.output).toBe('headphones-monitor');
  act(() => result.current.setMic('webcam'));
  await act(() => result.current.refreshSources());
  expect(result.current.mic).toBe('webcam');
  await act(() => result.current.refreshSources(true));
  expect(result.current.mic).toBe('vocaster');
  act(() => result.current.setSources([sources[0]]));
  expect(result.current.mic).toBe('');
  expect(result.current.output).toBe('');
});
it('retains selections on failure and coalesces simultaneous discovery', async () => {
  const { result } = renderHook(useCaptureDevices);
  act(() => result.current.setSources(sources));
  let reject!: (error: Error) => void;
  vi.mocked(library.sources).mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      })
  );
  let request!: Promise<void>;
  act(() => {
    request = result.current.refreshSources();
    void result.current.refreshSources();
  });
  expect(library.sources).toHaveBeenCalledTimes(1);
  await act(async () => {
    reject(new Error('offline'));
    await request;
  });
  expect(result.current.failed).toBe(true);
  expect(result.current.mic).toBe('vocaster');
  expect(result.current.loading).toBe(false);
});
