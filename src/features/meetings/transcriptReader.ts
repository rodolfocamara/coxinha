import type { ProcessingReport } from './library';

type Segment = ProcessingReport['segments'][number];
export type Range = [start: number, end: number];

/** Lowercase without accents, with a map back to the original character offsets. */
function fold(text: string) {
  let folded = '';
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const piece = text[i]
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    for (const ch of piece) {
      folded += ch;
      origin.push(i);
    }
  }
  return { folded, origin };
}

/** Where `query` occurs in `text`, ignoring case and accents, as original offsets. */
export function findRanges(text: string, query: string): Range[] {
  const needle = fold(query.trim()).folded;
  if (!needle) return [];
  const { folded, origin } = fold(text);
  const ranges: Range[] = [];
  for (
    let at = folded.indexOf(needle);
    at !== -1;
    at = folded.indexOf(needle, at + needle.length)
  ) {
    const end = at + needle.length - 1;
    ranges.push([origin[at], origin[end] + 1]);
  }
  return ranges;
}

/** What the reader shows for a line: the human correction when there is one. */
export const shownText = (report: ProcessingReport, segment: Segment) =>
  report.corrections?.[segment.id] ?? segment.text;

export type Group = { key: string; track: string; speaker: string | null; segments: Segment[] };

/** Consecutive lines of the same speaker on the same track read as one turn. */
export function groupSegments(segments: Segment[]): Group[] {
  const groups: Group[] = [];
  for (const segment of segments) {
    const last = groups[groups.length - 1];
    if (last && last.track === segment.track && last.speaker === segment.speaker) {
      last.segments.push(segment);
      continue;
    }
    groups.push({
      key: segment.id,
      track: segment.track,
      speaker: segment.speaker,
      segments: [segment],
    });
  }
  return groups;
}

export type Hit = { segment: string; range: Range };

/** Every match in reading order, for "n/m" navigation. */
export function findHits(report: ProcessingReport, query: string): Hit[] {
  return report.segments.flatMap((segment) =>
    findRanges(shownText(report, segment), query).map((range) => ({ segment: segment.id, range }))
  );
}
