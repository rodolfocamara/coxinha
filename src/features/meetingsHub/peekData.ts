import type { ProcessingReport } from '../meetings/library';
import { normalize } from './meetingRows';

/** "[mm:ss] Name: text", corrections applied, names only when confirmed (as the CLI). */
export function transcriptLines(report: ProcessingReport | null | undefined): string[] {
  if (!report) return [];
  return [...report.segments]
    .sort((a, b) => a.start_ms - b.start_ms || a.id.localeCompare(b.id))
    .map((segment) => {
      const confirmed = report.assignments.find(
        (a) =>
          a.speaker === segment.speaker &&
          (a.track ?? segment.track) === segment.track &&
          a.state === 'confirmed'
      );
      const name = confirmed?.name ?? segment.speaker ?? segment.track;
      const text = (report.corrections[segment.id] ?? segment.text).trim();
      const seconds = Math.floor(segment.start_ms / 1000);
      const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      return `[${clock}] ${name}: ${text}`;
    })
    .filter((line) => !line.endsWith(': '));
}

/** Lines matching the search first; without a search, the opening lines. */
export function excerpt(lines: string[], query: string, count = 3): string[] {
  const q = normalize(query);
  if (q) {
    const hits = lines.filter((line) => normalize(line).includes(q));
    if (hits.length) return hits.slice(0, count);
  }
  return lines.slice(0, count);
}

/** The opening lines of a Markdown note, without frontmatter or markup. */
export function noteLines(markdown: string, count = 5): string[] {
  const close = markdown.startsWith('---\n') ? markdown.indexOf('\n---', 3) : -1;
  const body = close < 0 ? markdown : markdown.slice(close + 4);
  return body
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/, '• ')
        .replace(/\*\*|__|`/g, '')
        .trim()
    )
    .filter(Boolean)
    .slice(0, count);
}
