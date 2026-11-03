import { describe, expect, it } from 'vitest';
import { BLEED_DB, BRIEF_SHARE, BRIEF_SPEECH_MS, foldedSpeakers, speakerKey } from './speakerNoise';
import type { ProcessingReport } from './library';

function report(
  turns: [track: string, speaker: string, seconds: number][],
  confirmed: [string, string][] = []
): ProcessingReport {
  let at = 0;
  return {
    job: 'job',
    segments: [],
    warnings: [],
    corrections: {},
    turns: turns.map(([track, speaker, seconds], i) => {
      const start = at;
      at += seconds * 1000;
      return { id: `t${i}`, track, speaker, start_ms: start, end_ms: at };
    }),
    assignments: confirmed.map(([track, speaker], i) => ({
      id: `a${i}`,
      track,
      speaker,
      person_id: `p${i}`,
      state: 'confirmed',
      name: 'Someone',
    })),
  };
}

describe('foldedSpeakers', () => {
  it('uses the thresholds measured in spec 0120', () => {
    expect([BRIEF_SPEECH_MS, BRIEF_SHARE, BLEED_DB]).toEqual([15_000, 0.01, 15]);
  });

  it('folds speakers under 15 s or under 1 % of their track', () => {
    const folds = foldedSpeakers(
      report([
        ['output', 'speaker-2', 3000],
        ['output', 'speaker-3', 14.9],
        ['output', 'speaker-4', 31],
        // Over 15 s, but under 1 % of about 3070 s.
        ['output', 'speaker-5', 25],
        ['output', 'unknown', 2],
      ]),
      null
    );
    expect(folds.get(speakerKey('output', 'speaker-3'))).toBe('brief');
    expect(folds.get(speakerKey('output', 'speaker-5'))).toBe('brief');
    expect(folds.has(speakerKey('output', 'speaker-2'))).toBe(false);
    expect(folds.has(speakerKey('output', 'speaker-4'))).toBe(false);
    expect(folds.has(speakerKey('output', 'unknown'))).toBe(false);
  });

  it('folds a microphone voice 15 dB under the dominant one, not a near voice', () => {
    const r = report([
      ['mic', 'speaker-1', 300],
      ['mic', 'speaker-2', 40],
      ['mic', 'speaker-3', 40],
    ]);
    const folds = foldedSpeakers(r, [
      { track: 'mic', speaker: 'speaker-1', levelDb: -39.4 },
      { track: 'mic', speaker: 'speaker-2', levelDb: -67.5 },
      { track: 'mic', speaker: 'speaker-3', levelDb: -42.3 },
    ]);
    expect(folds.get(speakerKey('mic', 'speaker-2'))).toBe('bleed');
    expect(folds.has(speakerKey('mic', 'speaker-3'))).toBe(false);
    expect(folds.has(speakerKey('mic', 'speaker-1'))).toBe(false);
    expect(
      foldedSpeakers(r, [{ track: 'mic', speaker: 'speaker-1', levelDb: -39.4 }]).size,
      'without a level only the brief rule applies'
    ).toBe(0);
    expect(
      foldedSpeakers(r, [
        { track: 'mic', speaker: 'speaker-1', levelDb: -39.4 },
        { track: 'mic', speaker: 'speaker-2', levelDb: -54.3 },
      ]).size
    ).toBe(0);
  });

  it('never folds a confirmed speaker', () => {
    const r = report(
      [
        ['output', 'speaker-2', 600],
        ['output', 'speaker-4', 3],
        ['mic', 'speaker-1', 300],
        ['mic', 'speaker-2b', 40],
      ],
      [
        ['output', 'speaker-4'],
        ['mic', 'speaker-2b'],
      ]
    );
    const folds = foldedSpeakers(r, [
      { track: 'mic', speaker: 'speaker-1', levelDb: -30 },
      { track: 'mic', speaker: 'speaker-2b', levelDb: -60 },
    ]);
    expect(folds.size).toBe(0);
  });
});
