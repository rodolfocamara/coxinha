import { describe, expect, it } from 'vitest';
import { buildRows, type MeetingRow } from './meetingRows';
import { event, recording, session } from './meetingsHub.fixtures';
import { NO_CATEGORY, categoryKey, nowAndNext, visibleRows } from './calendarHome';
import { filterResults, groupResults, highlight, mergeResults, NO_FILTERS } from './searchResults';
import { excerpt, noteLines, transcriptLines } from './peekData';

// Thursday 15 October 2026, 12:00 local; the week runs Monday 12 to Sunday 18.
const now = new Date(2026, 9, 15, 12);
const iso = (d: number, h: number, m = 0) => new Date(2026, 9, 15 + d, h, m).toISOString();
const master = [
  { name: 'CTO', preset: 10 },
  { name: 'Plain', preset: null },
];
const rows = buildRows(
  [
    session({ id: 'okr', title: 'OKR Q3', starts_at: iso(-3, 14), ends_at: iso(-3, 15) }),
    session({ id: 'old', title: 'Headcount kickoff', starts_at: iso(-40, 9) }),
  ],
  [
    event({
      id: 'cto',
      title: 'Pulso MX',
      startsAt: iso(0, 11, 30),
      endsAt: iso(0, 13),
      categories: ['Plain', 'CTO'],
      attendees: [{ name: 'Rosana Costa', email: 'rosana@x.com' }],
    }),
    event({ id: 'soon', title: 'Vendor call', startsAt: iso(0, 12, 20), endsAt: iso(0, 13) }),
    event({ id: 'tomorrow', title: 'Planning', startsAt: iso(1, 9), endsAt: iso(1, 10) }),
    event({ id: 'later', title: 'Board', startsAt: iso(9, 9), endsAt: iso(9, 10) }),
    event({
      id: 'gone',
      title: 'Cancelled',
      startsAt: iso(0, 12, 10),
      endsAt: iso(0, 13),
      cancelled: true,
    }),
  ],
  [recording('loose', 'Imported', 'finished', iso(-8, 10))]
);
const key = (row: MeetingRow) => row.key;

describe('calendar home', () => {
  it('filters rows by their first coloured category, or "no category"', () => {
    const cto = rows.find((r) => r.key === 'e:cto')!;
    expect(categoryKey(cto, master)).toBe('CTO');
    expect(categoryKey(rows.find((r) => r.key === 'e:soon')!, master)).toBe(NO_CATEGORY);
    expect(visibleRows(rows, ['CTO'], master).map(key)).not.toContain('e:cto');
    expect(visibleRows(rows, [NO_CATEGORY], master).map(key)).toEqual(['e:cto']);
    expect(visibleRows(rows, [], master)).toBe(rows);
  });

  it('finds the meeting on now and the next one today, skipping cancelled events', () => {
    const { current, next } = nowAndNext(rows, now, () => false);
    expect(current?.key).toBe('e:cto');
    expect(next?.key).toBe('e:soon');
    const live = nowAndNext(rows, now, (row) => row.key === 's:okr');
    expect(live.current?.key).toBe('s:okr');
    expect(nowAndNext(rows, new Date(2026, 9, 15, 20), () => false)).toEqual({
      current: null,
      next: null,
    });
  });
});

describe('search results', () => {
  const hits = [
    {
      id: 'okr',
      title: 'OKR Q3',
      startsAt: iso(-3, 14),
      matches: [
        { field: 'title' as const, snippet: 'ignored, the row title wins' },
        { field: 'transcript' as const, snippet: 'Rosana: o headcount fecha na próxima' },
      ],
    },
  ];

  it('merges local and backend matches with one snippet per field in a fixed order', () => {
    const found = mergeResults(rows, 'headcount', hits);
    expect(found.map((r) => [r.row.key, r.matches.map((m) => m.field)])).toEqual([
      ['s:okr', ['transcript']],
      ['s:old', ['title']],
    ]);
    const people = mergeResults(rows, 'rosana@', []);
    expect(people[0].matches).toEqual([{ field: 'people', snippet: 'Rosana Costa' }]);
    const category = mergeResults(rows, 'cto', []);
    expect(category[0].matches).toEqual([{ field: 'category', snippet: 'CTO' }]);
    expect(mergeResults(rows, '  ', hits)).toEqual([]);
  });

  it('groups later, this week, last week and months, newest first', () => {
    const all = mergeResults(rows, 'o', []).concat(mergeResults(rows, 'imported', []));
    const groups = groupResults(all, now);
    expect(groups.map((g) => g.id)).toEqual([
      'later',
      'today',
      'week',
      'lastWeek',
      'month-2026-09',
    ]);
    // Newest first inside a past group.
    expect(groups.find((g) => g.id === 'today')!.results.map((r) => r.row.key)).toEqual([
      'e:soon',
      'e:cto',
    ]);
  });

  it('filters by period, person, category and transcript', () => {
    const all = mergeResults(rows, 'o', hits);
    const keys = (filters: Partial<typeof NO_FILTERS>) =>
      filterResults(all, { ...NO_FILTERS, ...filters }, now).map((r) => r.row.key);
    expect(keys({ period: '30d' })).not.toContain('s:old');
    expect(keys({ period: '30d' })).not.toContain('e:later');
    expect(keys({ period: 'year' })).toContain('s:old');
    expect(keys({ person: 'Rosana Costa' })).toEqual(['e:cto']);
    expect(keys({ category: 'CTO' })).toEqual(['e:cto']);
    expect(keys({ transcript: true })).toEqual(['s:okr']);
  });

  it('marks matches ignoring accents and case', () => {
    expect(highlight('Revisão do Orçamento', 'orcamento')).toEqual([
      { text: 'Revisão do ', hit: false },
      { text: 'Orçamento', hit: true },
    ]);
    expect(highlight('abc', '')).toEqual([{ text: 'abc', hit: false }]);
  });
});

describe('peek text', () => {
  it('formats transcript lines with confirmed names and corrections', () => {
    const lines = transcriptLines({
      job: 'j',
      turns: [],
      warnings: [],
      corrections: { b: 'fecha o headcount' },
      assignments: [
        {
          id: 'a',
          speaker: 'S1',
          track: 'output',
          person_id: 'p',
          state: 'confirmed',
          name: 'Ana',
        },
        {
          id: 'c',
          speaker: 'S2',
          track: 'output',
          person_id: 'q',
          state: 'suggested',
          name: 'Bia',
        },
      ],
      segments: [
        { id: 'b', track: 'output', start_ms: 65_000, end_ms: 1, text: 'x', speaker: 'S1' },
        { id: 'a', track: 'mic', start_ms: 1000, end_ms: 1, text: 'oi', speaker: null },
        { id: 'c', track: 'output', start_ms: 70_000, end_ms: 1, text: 'tchau', speaker: 'S2' },
      ],
    });
    expect(lines).toEqual([
      '[00:01] mic: oi',
      '[01:05] Ana: fecha o headcount',
      '[01:10] S2: tchau',
    ]);
    expect(excerpt(lines, 'HEADCOUNT')).toEqual(['[01:05] Ana: fecha o headcount']);
    expect(excerpt(lines, 'nothing', 2)).toEqual(lines.slice(0, 2));
  });

  it('reads the opening lines of a note without frontmatter or markup', () => {
    expect(
      noteLines('---\nid: x\n---\n# Pauta\n\n- [ ] **Decidir** o backend\n`código`\n', 5)
    ).toEqual(['Pauta', '• Decidir o backend', 'código']);
    expect(noteLines('---\nno closing\n', 2)).toEqual(['---', 'no closing']);
  });
});
