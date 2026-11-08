import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoundedPlayback } from './useBoundedPlayback';
let mic: HTMLAudioElement;
let output: HTMLAudioElement;
let players: { current: Record<string, HTMLAudioElement | null> };
const error = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  error.mockReset();
  mic = document.createElement('audio');
  output = document.createElement('audio');
  for (const p of [mic, output]) {
    vi.spyOn(p, 'pause').mockImplementation(() => {});
    vi.spyOn(p, 'play').mockResolvedValue(undefined);
  }
  players = { current: { mic, output } };
});
afterEach(() => vi.useRealTimers());
const setup = () =>
  renderHook(({ scope, enabled }) => useBoundedPlayback(players, scope, enabled, error), {
    initialProps: { scope: 'meeting:people', enabled: true },
  });
it('plays synchronously on the requested track, pauses and replays from the excerpt start', async () => {
  const { result } = setup();
  act(() => result.current.play({ track: 'output', start: 2, end: 4 }));
  expect(output.currentTime).toBe(2);
  expect(output.play).toHaveBeenCalledTimes(1);
  expect(mic.play).not.toHaveBeenCalled();
  act(() => result.current.play({ track: 'output', start: 2, end: 4 }));
  expect(result.current.current).toBeNull();
  output.currentTime = 3;
  act(() => result.current.play({ track: 'output', start: 2, end: 4 }));
  expect(output.currentTime).toBe(2);
  await act(async () => {});
  output.currentTime = 4;
  act(() => vi.advanceTimersByTime(2000));
  expect(result.current.current).toBeNull();
  expect(output.pause).toHaveBeenCalled();
});
it('stops at the media boundary even before the wall-clock timeout', () => {
  const { result } = setup();
  act(() => result.current.play({ track: 'mic', start: 1, end: 3 }));
  mic.currentTime = 3;
  act(() => mic.dispatchEvent(new Event('timeupdate')));
  expect(result.current.current).toBeNull();
  expect(mic.pause).toHaveBeenCalled();
});
it('stops on speaker switch, tab/job/meeting change, disable and disposal', () => {
  const { result, rerender, unmount } = setup();
  act(() => result.current.play({ track: 'mic', start: 1, end: 3 }));
  act(() => result.current.play({ track: 'output', start: 4, end: 6 }));
  expect(mic.pause).toHaveBeenCalled();
  rerender({ scope: 'meeting:transcript', enabled: true });
  expect(result.current.current).toBeNull();
  act(() => result.current.play({ track: 'output', start: 4, end: 6 }));
  rerender({ scope: 'new-meeting:people:new-job', enabled: true });
  expect(result.current.current).toBeNull();
  act(() => result.current.play({ track: 'output', start: 4, end: 6 }));
  rerender({ scope: 'new-meeting:people:new-job', enabled: false });
  expect(result.current.current).toBeNull();
  act(() => result.current.play({ track: 'output', start: 4, end: 6 }));
  expect(result.current.current).toBeNull();
  rerender({ scope: 'last', enabled: true });
  act(() => result.current.play({ track: 'mic', start: 1, end: 3 }));
  vi.mocked(mic.pause).mockClear();
  unmount();
  expect(mic.pause).toHaveBeenCalled();
});
it('keeps stopped async play completions from restarting a timer or surfacing stale errors', async () => {
  let finish!: () => void;
  vi.mocked(mic.play).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result } = setup();
  act(() => result.current.play({ track: 'mic', start: 1, end: 3 }));
  act(() => result.current.play({ track: 'output', start: 4, end: 8 }));
  await act(async () => finish());
  expect(mic.play).toHaveBeenCalledTimes(1);
  expect(error).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(2000));
  expect(result.current.current).not.toBeNull();
});
it('surfaces missing tracks, rejected play and media errors, with no automatic retry', async () => {
  const { result } = setup();
  act(() => result.current.play({ track: 'absent', start: 0, end: 1 }));
  expect(error).toHaveBeenCalledTimes(1);
  vi.mocked(mic.play).mockRejectedValueOnce(new Error('blocked'));
  await act(async () => result.current.play({ track: 'mic', start: 0, end: 1 }));
  expect(error).toHaveBeenCalledTimes(2);
  expect(result.current.current).toBeNull();
  act(() => result.current.play({ track: 'output', start: 1, end: 3 }));
  act(() => output.dispatchEvent(new Event('error')));
  expect(error).toHaveBeenCalledTimes(3);
  expect(output.play).toHaveBeenCalledTimes(1);
});
it('pauses detached audio on cleanup and avoids overlapping native track controls', () => {
  const { result, unmount } = setup();
  act(() => result.current.play({ track: 'mic', start: 0, end: 3 }));
  act(() => result.current.nativePlay('output'));
  expect(result.current.current).toBeNull();
  expect(mic.pause).toHaveBeenCalled();
  act(() => result.current.play({ track: 'mic', start: 0, end: 3 }));
  players.current.mic = null;
  vi.mocked(mic.pause).mockClear();
  unmount();
  expect(mic.pause).toHaveBeenCalled();
});

it('waits for the media clock when wall time reaches the requested end first', async () => {
  const { result } = setup();
  act(() => result.current.play({ track: 'mic', start: 2, end: 4 }));
  await act(async () => {});
  mic.currentTime = 3.75;
  act(() => vi.advanceTimersByTime(2000));
  expect(result.current.current).not.toBeNull();
  mic.currentTime = 4;
  act(() => vi.advanceTimersByTime(250));
  expect(result.current.current).toBeNull();
});

it('stops stalled sources without spinning and enforces bounds after seeks and rate changes', async () => {
  const { result } = setup();
  act(() => result.current.play({ track: 'mic', start: 2, end: 4 }));
  await act(async () => {});
  act(() => vi.advanceTimersByTime(10000));
  expect(result.current.current).toBeNull();
  expect(error).toHaveBeenCalledTimes(1);
  act(() => result.current.play({ track: 'output', start: 2, end: 4 }));
  output.playbackRate = 2;
  act(() => output.dispatchEvent(new Event('ratechange')));
  output.currentTime = 3.8;
  act(() => output.dispatchEvent(new Event('seeked')));
  act(() => vi.advanceTimersByTime(100));
  expect(result.current.current).not.toBeNull();
  output.currentTime = 4;
  act(() => vi.advanceTimersByTime(100));
  expect(result.current.current).toBeNull();
  act(() => result.current.play({ track: 'output', start: 2, end: 4 }));
  output.currentTime = 1;
  act(() => output.dispatchEvent(new Event('seeked')));
  expect(result.current.current).toBeNull();
});

it('bounds repeated in-range seeks even while the media clock keeps changing', async () => {
  const { result } = setup();
  act(() => result.current.play({ track: 'mic', start: 2, end: 4 }));
  await act(async () => {});
  for (let i = 0; i < 100; i++) {
    mic.currentTime = i % 2 ? 2.5 : 3;
    act(() => {
      mic.dispatchEvent(new Event('seeked'));
      vi.advanceTimersByTime(1000);
    });
  }
  expect(result.current.current).toBeNull();
  expect(error).toHaveBeenCalledTimes(1);
});

// HTML pause() changes paused synchronously but queues the pause event as a task.
function queuedMedia(player: HTMLAudioElement) {
  let paused = true;
  const delivered: boolean[] = [];
  vi.spyOn(player, 'paused', 'get').mockImplementation(() => paused);
  vi.mocked(player.play).mockImplementation(() => {
    paused = false;
    return Promise.resolve();
  });
  vi.mocked(player.pause).mockImplementation(() => {
    if (paused) return;
    paused = true;
    setTimeout(() => {
      delivered.push(player.paused);
      player.dispatchEvent(new Event('pause'));
    }, 0);
  });
  return delivered;
}
it('R3 ignores a queued pause from the previous same-track excerpt but honors a real pause', async () => {
  const delivered = queuedMedia(mic);
  const { result } = setup();
  act(() => result.current.play({ track: 'mic', start: 2, end: 4 }));
  act(() => result.current.play({ track: 'mic', start: 5, end: 7 }));
  await act(async () => {
    vi.advanceTimersByTime(0);
  });
  expect(delivered[0]).toBe(false);
  expect(result.current.current).not.toBeNull();
  expect(mic.currentTime).toBe(5);
  act(() => {
    mic.pause();
    vi.advanceTimersByTime(0);
  });
  expect(result.current.current).toBeNull();
});
it('R3 ignores a queued native full-track pause after the same track starts an excerpt', async () => {
  const delivered = queuedMedia(mic);
  const { result } = setup();
  await act(async () => {
    await mic.play();
  });
  act(() => result.current.play({ track: 'mic', start: 2, end: 4 }));
  await act(async () => {
    vi.advanceTimersByTime(0);
  });
  expect(delivered[0]).toBe(false);
  expect(result.current.current).not.toBeNull();
  expect(error).not.toHaveBeenCalled();
});
