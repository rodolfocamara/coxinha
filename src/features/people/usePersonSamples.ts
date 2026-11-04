import { useRef, useState } from 'react';
import { voiceCuration, validVoiceOrigin, type PersonSamples } from '../meetings/voiceCuration';
import { useVoiceInventoryPages } from '../meetings/useVoiceInventoryPages';

export type VoiceSample = PersonSamples['samples'][number];

/** Counts and per-space durations of the loaded samples only (spec 0078: never global totals). */
export function loadedStats(samples: VoiceSample[]) {
  const groups = new Map<
    string,
    { space: VoiceSample['space']; count: number; duration: number }
  >();
  const meetings = new Set<string>();
  let revoked = 0;
  let invalidated = 0;
  let active = 0;
  for (const sample of samples) {
    if (sample.state === 'revoked') {
      revoked++;
      continue;
    }
    if (sample.state === 'invalidated') {
      invalidated++;
      continue;
    }
    active++;
    meetings.add(sample.meetingId);
    const space = sample.space;
    const key = JSON.stringify([
      space.model,
      space.revision,
      space.model_hash,
      space.preprocessing,
      space.dimension,
    ]);
    const group = groups.get(key) ?? { space, count: 0, duration: 0 };
    group.count++;
    group.duration += sample.endMs - sample.startMs;
    groups.set(key, group);
  }
  return { active, revoked, invalidated, meetings: meetings.size, groups: [...groups.entries()] };
}

/**
 * One person's sample pages bound to the profile generation, plus the guarded
 * revoke used by both the People screen and the meeting speaker review.
 */
export function usePersonSamples({
  personId,
  enabled,
  version,
  generation,
  onStale,
  disabled,
  act,
}: {
  personId: string;
  enabled: boolean;
  version: unknown;
  generation: number | null;
  onStale: () => void;
  disabled: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const query = useVoiceInventoryPages(
    enabled,
    personId,
    version,
    async (cursor) => {
      const page = await voiceCuration.samplesPage(personId, cursor);
      if (page.personId !== personId) throw new Error('voice_curation_refresh_required');
      return { ...page, items: page.samples };
    },
    (sample) => sample.sampleId,
    { generation, onStale }
  );
  const locked = disabled || busy || !query.fresh;

  /** Revokes one active, loaded sample with a human reason. Resolves true on success. */
  async function revoke(sampleId: string, origin: string) {
    if (
      locked ||
      pending.current ||
      !validVoiceOrigin(origin) ||
      !query.items.some((sample) => sample.sampleId === sampleId && sample.state === 'active')
    )
      return false;
    pending.current = true;
    setBusy(true);
    setError(null);
    let ok = false;
    try {
      await act(async () => {
        try {
          await voiceCuration.revoke(personId, sampleId, origin.trim());
          ok = true;
        } catch (failure) {
          setError(failure);
          throw failure;
        } finally {
          query.invalidate();
        }
      });
    } catch (failure) {
      setError(failure);
    } finally {
      pending.current = false;
      setBusy(false);
    }
    return ok;
  }

  return {
    query,
    stats: loadedStats(query.items),
    busy,
    locked,
    error: error || query.error,
    revoke,
    restart: () => {
      setError(null);
      query.restart();
    },
  };
}
