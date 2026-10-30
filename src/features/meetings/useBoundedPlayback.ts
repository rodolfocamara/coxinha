import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
export type Excerpt = { track: string; start: number; end: number };
export type ExcerptPlayback = {
  current: string | null;
  play: (excerpt: Excerpt) => void;
  stop: () => void;
  nativePlay: (track: string) => void;
};
export const excerptKey = (e: Excerpt) => JSON.stringify([e.track, e.start, e.end]);

// Uses only the already granted RecordingDetail audio elements; no file access.
export function useBoundedPlayback(
  players: RefObject<Record<string, HTMLAudioElement | null>>,
  scope: string,
  enabled: boolean,
  onError: () => void
): ExcerptPlayback {
  const [current, setCurrent] = useState<string | null>(null);
  const sequence = useRef(0);
  const activeTrack = useRef<string | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  const stop = useCallback(() => {
    ++sequence.current;
    cleanup.current();
    cleanup.current = () => {};
    activeTrack.current = null;
    Object.values(players.current).forEach((player) => {
      if (player && !player.paused) player.pause();
    });
    setCurrent(null);
  }, [players]);
  useLayoutEffect(() => {
    stop();
    return stop;
  }, [scope, enabled, stop]);

  function play(excerpt: Excerpt) {
    const key = excerptKey(excerpt);
    const pauseOnly = current === key;
    stop();
    if (pauseOnly || !enabled) return;
    const player = players.current[excerpt.track];
    if (
      !player ||
      !Number.isFinite(excerpt.start) ||
      !Number.isFinite(excerpt.end) ||
      excerpt.start < 0 ||
      excerpt.end <= excerpt.start
    ) {
      errorHandler.current();
      return;
    }
    const token = sequence.current;
    activeTrack.current = excerpt.track;
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (token === sequence.current) stop();
    };
    const fail = () => {
      if (token === sequence.current) {
        stop();
        errorHandler.current();
      }
    };
    const paused = () => {
      // pause() queues its event. A newer play() may already have resumed this track.
      if (player.paused) finish();
    };
    const startedAt = Date.now();
    let progressedAt = startedAt;
    let lastClock = excerpt.start;
    // A stalled source or repeated seeks cannot leave an excerpt running forever.
    const maxWallMs = Math.max(60000, (excerpt.end - excerpt.start) * 32000 + 10000);
    const check = () => {
      if (token !== sequence.current) return;
      const clock = player.currentTime;
      if (clock >= excerpt.end || clock < excerpt.start) {
        finish();
        return;
      }
      const now = Date.now();
      if (Math.abs(clock - lastClock) > 0.001) {
        progressedAt = now;
        lastClock = clock;
      }
      if (now - progressedAt >= 10000 || now - startedAt >= maxWallMs) {
        fail();
        return;
      }
      arm();
    };
    const arm = () => {
      if (token !== sequence.current) return;
      clearTimeout(timer);
      // The media clock is authoritative. Device startup/stalls can lag wall time.
      // Recheck at 30ms..1s intervals instead of finishing on a wall-clock guess.
      const remaining =
        ((excerpt.end - player.currentTime) * 1000) / Math.max(0.1, player.playbackRate || 1);
      timer = setTimeout(check, Math.max(30, Math.min(1000, remaining)));
    };
    const bound = () => {
      check();
    };
    player.addEventListener('timeupdate', bound);
    player.addEventListener('ended', finish);
    player.addEventListener('error', fail);
    player.addEventListener('pause', paused);
    player.addEventListener('playing', arm);
    player.addEventListener('ratechange', arm);
    player.addEventListener('seeked', bound);
    cleanup.current = () => {
      clearTimeout(timer);
      player.removeEventListener('timeupdate', bound);
      player.removeEventListener('ended', finish);
      player.removeEventListener('error', fail);
      player.removeEventListener('pause', paused);
      player.removeEventListener('playing', arm);
      player.removeEventListener('ratechange', arm);
      player.removeEventListener('seeked', bound);
      player.pause();
    };
    try {
      player.currentTime = excerpt.start;
      setCurrent(key);
      // Call synchronously inside the click gesture, never after a fetch.
      const result = player.play();
      arm();
      void result
        ?.then(() => {
          if (token === sequence.current) arm();
        })
        .catch(fail);
    } catch {
      fail();
    }
  }
  function nativePlay(track: string) {
    if (activeTrack.current !== track) {
      ++sequence.current;
      cleanup.current();
      cleanup.current = () => {};
      activeTrack.current = null;
      setCurrent(null);
    }
    Object.entries(players.current).forEach(([other, player]) => {
      if (other !== track && player && !player.paused) player.pause();
    });
  }
  return { current, play, stop, nativePlay };
}
