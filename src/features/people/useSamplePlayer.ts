import { useEffect, useRef, useState } from 'react';
import { library, type LibraryDetail } from '../meetings/library';
import type { VoiceSample } from './usePersonSamples';

/**
 * Plays one voice sample: the meeting's track audio between the sample's
 * start and end. Reads `library_detail` once per meeting to get the granted
 * audio source; nothing is written.
 */
export function useSamplePlayer() {
  const [playing, setPlaying] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const details = useRef(new Map<string, Promise<LibraryDetail>>());
  const token = useRef(0);

  function stop() {
    token.current++;
    const current = audio.current;
    audio.current = null;
    if (current) {
      current.pause();
      current.removeAttribute('src');
    }
    setPlaying(null);
  }

  async function play(sample: VoiceSample) {
    stop();
    const mine = token.current;
    setFailed(null);
    setPlaying(sample.sampleId);
    try {
      let detail = details.current.get(sample.meetingId);
      if (!detail) {
        detail = library.detail(sample.meetingId);
        details.current.set(sample.meetingId, detail);
        detail.catch(() => details.current.delete(sample.meetingId));
      }
      const source = (await detail).audio?.[sample.track];
      if (!source) throw new Error('sample_audio_missing');
      if (mine !== token.current) return;
      const element = new Audio(library.audioUrl(source));
      audio.current = element;
      const end = sample.endMs / 1000;
      element.addEventListener('timeupdate', () => {
        if (element.currentTime >= end && audio.current === element) stop();
      });
      element.addEventListener('ended', () => audio.current === element && stop());
      element.currentTime = sample.startMs / 1000;
      await element.play();
    } catch {
      if (mine !== token.current) return;
      stop();
      setFailed(sample.sampleId);
    }
  }

  useEffect(() => stop, []);

  return {
    playing,
    failed,
    toggle: (sample: VoiceSample) => (playing === sample.sampleId ? stop() : void play(sample)),
  };
}
