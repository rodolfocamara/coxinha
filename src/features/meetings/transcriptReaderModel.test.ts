import { describe, expect, it } from 'vitest';
import type { ProcessingReport } from './library';
import { findHits, findRanges, groupSegments } from './transcriptReaderModel';

const segment = (id: string, speaker: string | null, text: string, track = 'output') => ({
  id,
  track,
  speaker,
  text,
  start_ms: 0,
  end_ms: 1000,
});

describe('findRanges', () => {
  it('ignores case and accents and returns offsets in the original text', () => {
    const text = 'Reunião sobre a REUNIAO de orçamento';
    expect(findRanges(text, 'reuniao').map(([a, b]) => text.slice(a, b))).toEqual([
      'Reunião',
      'REUNIAO',
    ]);
    const [[from, to]] = findRanges(text, 'Orcamento');
    expect(text.slice(from, to)).toBe('orçamento');
  });

  it('never overlaps and ignores an empty query', () => {
    expect(findRanges('aaaa', 'aa')).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(findRanges('texto', '  ')).toEqual([]);
  });
});

describe('groupSegments', () => {
  it('joins consecutive lines of one speaker on one track', () => {
    const groups = groupSegments([
      segment('1', 'speaker-1', 'a'),
      segment('2', 'speaker-1', 'b'),
      segment('3', 'speaker-2', 'c'),
      segment('4', 'speaker-2', 'd', 'mic'),
      segment('5', null, 'e'),
      segment('6', null, 'f'),
    ]);
    expect(groups.map((g) => g.segments.map((s) => s.id))).toEqual([
      ['1', '2'],
      ['3'],
      ['4'],
      ['5', '6'],
    ]);
  });
});

describe('findHits', () => {
  it('searches what the reader shows, corrections included, in reading order', () => {
    const report = {
      job: 'j',
      turns: [],
      warnings: [],
      assignments: [],
      corrections: { '2': 'headcount aprovado' },
      segments: [
        segment('1', null, 'falamos de headcount'),
        segment('2', null, 'texto da máquina'),
      ],
    } satisfies ProcessingReport;
    expect(findHits(report, 'headcount')).toEqual([
      { segment: '1', range: [11, 20] },
      { segment: '2', range: [0, 9] },
    ]);
    expect(findHits(report, 'máquina')).toEqual([]);
  });
});
