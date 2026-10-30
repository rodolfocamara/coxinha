import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useJointPlayback } from './useJointPlayback';

let mic: HTMLAudioElement;
let output: HTMLAudioElement;
let players: { current: Record<string, HTMLAudioElement> };
beforeEach(() => {
  vi.useFakeTimers();
  [mic, output] = [10, 20].map((duration) => {
    const p = document.createElement('audio');
    Object.defineProperty(p, 'duration', { value: duration, configurable: true });
    vi.spyOn(p, 'play').mockResolvedValue(undefined);
    vi.spyOn(p, 'pause').mockImplementation(() => {});
    return p;
  });
  players = { current: { mic, output } };
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const setup = () =>
  renderHook(({ scope }) => useJointPlayback(players, scope), { initialProps: { scope: 'one' } });

it('starts both sources in the gesture and follows media time rather than wall time', async () => {
  const { result } = setup();
  act(() => result.current.play());
  expect(mic.play).toHaveBeenCalledTimes(1);
  expect(output.play).toHaveBeenCalledTimes(1);
  expect(mic.volume + output.volume).toBe(1);
  output.currentTime = 2;
  mic.currentTime = 1.6;
  act(() => vi.advanceTimersByTime(100));
  expect(result.current.time).toBe(2);
  expect(mic.currentTime).toBe(2);
  act(() => result.current.stop());
  expect(result.current.playing).toBe(false);
  act(() => result.current.play());
  expect(output.currentTime).toBe(2);
  await act(async () => {});
});

it('continues past a shorter track and ends with the longest one', () => {
  const { result } = setup();
  act(() => result.current.play());
  mic.currentTime = 10;
  output.currentTime = 12;
  act(() => {
    mic.dispatchEvent(new Event('ended'));
    vi.advanceTimersByTime(100);
  });
  expect(result.current.playing).toBe(true);
  expect(mic.currentTime).toBe(10);
  output.currentTime = 20;
  act(() => output.dispatchEvent(new Event('ended')));
  expect(result.current.playing).toBe(false);
  expect(result.current.time).toBe(20);
});

it('seeks all tracks without starting playback and does not replay an exhausted shorter track', () => {
  const { result } = setup();
  act(() => result.current.seek(14));
  expect(mic.currentTime).toBe(10);
  expect(output.currentTime).toBe(14);
  expect(mic.play).not.toHaveBeenCalled();
  act(() => result.current.play());
  expect(mic.play).not.toHaveBeenCalled();
  expect(output.play).toHaveBeenCalledTimes(1);
});

it('pauses every source on buffering/error and retries explicitly', async () => {
  const { result } = setup();
  act(() => result.current.play());
  act(() => mic.dispatchEvent(new Event('waiting')));
  expect(result.current.issue).toBe('buffering');
  expect(result.current.playing).toBe(false);
  expect(output.pause).toHaveBeenCalled();
  vi.mocked(output.play).mockRejectedValueOnce(new Error('denied'));
  await act(async () => result.current.play());
  expect(result.current.issue).toBe('error');
  expect(result.current.playing).toBe(false);
  await act(async () => result.current.play());
  expect(result.current.issue).toBeNull();
});

it('does not treat a wall-clock stall as successful playback', () => {
  const { result } = setup();
  act(() => result.current.play());
  act(() => vi.advanceTimersByTime(10100));
  expect(result.current.time).toBe(0);
  expect(result.current.issue).toBe('buffering');
});

it('ignores queued old pause events but stops both on a genuine external pause', () => {
  const { result } = setup();
  let paused = false;
  Object.defineProperty(mic, 'paused', { get: () => paused });
  act(() => result.current.play());
  act(() => mic.dispatchEvent(new Event('pause')));
  expect(result.current.playing).toBe(true);
  paused = true;
  act(() => mic.dispatchEvent(new Event('pause')));
  expect(result.current.playing).toBe(false);
  expect(output.pause).toHaveBeenCalled();
});

it('stops late completions after scope change and unmount without reviving playback', async () => {
  let resolve!: () => void;
  vi.mocked(mic.play).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const { result, rerender, unmount } = setup();
  act(() => result.current.play());
  rerender({ scope: 'two' });
  vi.mocked(mic.pause).mockClear();
  await act(async () => resolve());
  expect(mic.pause).toHaveBeenCalled();
  expect(result.current.playing).toBe(false);
  act(() => result.current.play());
  unmount();
  vi.mocked(mic.pause).mockClear();
  await act(async () => resolve());
  expect(mic.pause).toHaveBeenCalled();
});

it('late joint play acknowledgement cannot pause a newly selected speaker excerpt', async () => {
  let resolve!: () => void;
  vi.mocked(mic.play).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const { result } = setup();
  act(() => result.current.play());
  act(() => result.current.release());
  vi.mocked(mic.pause).mockClear();
  await act(async () => resolve());
  expect(mic.pause).not.toHaveBeenCalled();
});

it('does not claim readiness for missing duration and accepts single imported audio', () => {
  Object.defineProperty(mic, 'duration', { value: NaN });
  const { result } = setup();
  expect(result.current.ready).toBe(false);
  act(() => result.current.play());
  expect(output.play).not.toHaveBeenCalled();
  delete players.current.mic;
  act(() => result.current.refresh());
  expect(result.current.ready).toBe(true);
  act(() => result.current.play());
  expect(output.volume).toBe(1);
});
