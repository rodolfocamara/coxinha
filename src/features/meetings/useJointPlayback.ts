import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

// Streams existing granted media elements; never loads complete recordings into RAM.
export function useJointPlayback(
  players: RefObject<Record<string, HTMLAudioElement | null>>,
  scope: string
) {
  const active = useRef(false);
  const sequence = useRef(0);
  const otherPlayback = useRef(false);
  const cleanup = useRef(() => {});
  const position = useRef(0);
  const gain = useRef(1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);
  const [issue, setIssue] = useState<'buffering' | 'error' | null>(null);
  const list = useCallback(
    () => Object.values(players.current).filter((p): p is HTMLAudioElement => !!p),
    [players]
  );
  const stop = useCallback(() => {
    ++sequence.current;
    active.current = false;
    cleanup.current();
    cleanup.current = () => {};
    for (const player of list()) {
      player.pause();
      player.volume = 1;
    }
    setPlaying(false);
  }, [list]);
  useLayoutEffect(() => {
    stop();
    position.current = 0;
    setTime(0);
    setIssue(null);
    const media = list();
    setReady(
      media.length > 0 &&
        media.every((p) => Number.isFinite(p.duration)) &&
        media.some((p) => p.duration > 0)
    );
    setDuration(Math.max(0, ...media.map((p) => (Number.isFinite(p.duration) ? p.duration : 0))));
    return () => {
      otherPlayback.current = false;
      stop();
    };
  }, [scope, stop, list]);

  function refresh() {
    const media = list();
    setReady(
      media.length > 0 &&
        media.every((p) => Number.isFinite(p.duration)) &&
        media.some((p) => p.duration > 0)
    );
    setDuration(Math.max(0, ...media.map((p) => (Number.isFinite(p.duration) ? p.duration : 0))));
  }
  function seek(value: number) {
    stop();
    position.current = Math.max(0, Math.min(duration, value));
    setTime(position.current);
    for (const player of list()) {
      if (Number.isFinite(player.duration))
        player.currentTime = Math.min(position.current, player.duration);
    }
  }
  function volume(value: number) {
    gain.current = Math.max(0, Math.min(1, value));
    if (active.current) for (const player of list()) player.volume = gain.current / list().length;
  }
  function play() {
    stop();
    otherPlayback.current = false;
    const media = list();
    if (
      !media.length ||
      media.some((p) => !Number.isFinite(p.duration)) ||
      !media.some((p) => p.duration > 0)
    )
      return;
    const master = media.reduce((a, b) => (a.duration >= b.duration ? a : b));
    if (position.current >= master.duration) position.current = 0;
    const token = sequence.current;
    active.current = true;
    setIssue(null);
    setPlaying(true);
    const fail = (reason: 'buffering' | 'error') => {
      if (token !== sequence.current) return;
      position.current = master.currentTime;
      setTime(position.current);
      stop();
      setIssue(reason);
    };
    const buffering = () => fail('buffering');
    const error = () => fail('error');
    const paused = (event: Event) => {
      const player = event.currentTarget as HTMLAudioElement;
      // An old pause event can arrive after a new play has already started.
      if (player.paused && !player.ended && player.currentTime < player.duration) fail('buffering');
    };
    let progressed = Date.now();
    let lastClock = position.current;
    const tick = () => {
      if (token !== sequence.current) return;
      position.current = master.currentTime;
      setTime(position.current);
      if (master.ended || master.currentTime >= master.duration) {
        stop();
        return;
      }
      if (Math.abs(lastClock - master.currentTime) > 0.001) {
        lastClock = master.currentTime;
        progressed = Date.now();
      } else if (Date.now() - progressed > 10000) {
        fail('buffering');
        return;
      }
      for (const player of media) {
        if (
          player !== master &&
          !player.ended &&
          player.currentTime < player.duration &&
          Math.abs(player.currentTime - master.currentTime) > 0.15
        ) {
          player.currentTime = Math.min(master.currentTime, player.duration);
        }
      }
    };
    const timer = setInterval(tick, 100);
    master.addEventListener('ended', tick);
    for (const player of media) {
      player.addEventListener('waiting', buffering);
      player.addEventListener('error', error);
      player.addEventListener('pause', paused);
    }
    cleanup.current = () => {
      clearInterval(timer);
      master.removeEventListener('ended', tick);
      for (const player of media) {
        player.removeEventListener('waiting', buffering);
        player.removeEventListener('error', error);
        player.removeEventListener('pause', paused);
      }
    };
    for (const player of media) {
      if (token !== sequence.current) break;
      try {
        player.volume = gain.current / media.length;
        player.playbackRate = 1;
        player.currentTime = Math.min(position.current, player.duration);
        if (player.currentTime >= player.duration) continue;
        // All play calls stay in the original user gesture.
        void player
          .play()
          ?.then(() => {
            if (token !== sequence.current && !active.current && !otherPlayback.current)
              player.pause();
          })
          .catch(error);
      } catch {
        error();
        break;
      }
    }
  }
  function release() {
    stop();
    otherPlayback.current = true;
  }
  function claimIndividual() {
    otherPlayback.current = true;
  }
  return {
    active,
    playing,
    time,
    duration,
    ready,
    issue,
    refresh,
    play,
    stop,
    release,
    claimIndividual,
    seek,
    volume,
  };
}
