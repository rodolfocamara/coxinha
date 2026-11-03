import { describe, expect, it } from 'vitest';
import {
  buildGroups,
  highlight,
  meetingTier,
  PER_KIND,
  titleTier,
  type MeetingHit,
  type UniversalAnswer,
} from './universalSearch';

const now = new Date('2026-11-03T12:00:00Z');
const meeting = (
  id: string,
  title: string,
  startsAt: string | null,
  matches: MeetingHit['matches']
): MeetingHit => ({ id, title, startsAt, matches });
const empty: UniversalAnswer = { notes: [], meetings: [], events: [], people: [] };
const kinds = (groups: ReturnType<typeof buildGroups>) => groups.map((g) => g.kind);
const keys = (groups: ReturnType<typeof buildGroups>, kind: string) =>
  groups.find((g) => g.kind === kind)!.items.map((i) => i.key);

describe('universal search groups (spec 0122 P3)', () => {
  it('tiers titles by prefix, then contains, people, body and transcript', () => {
    expect(titleTier('Orçamento 2027', 'orcamento')).toBe(0);
    expect(titleTier('Revisão do Orçamento', 'ORÇAMENTO')).toBe(1);
    expect(titleTier('Retro', 'orcamento')).toBeNull();
    const hit = meeting('s', 'Retro', null, [
      { field: 'people', snippet: 'Ana' },
      { field: 'transcript', snippet: 'x', atMs: 1 },
    ]);
    expect(meetingTier(hit, 'ana')).toBe(2);
    expect(meetingTier(hit, 'ana', [hit.matches[1]])).toBe(4);
  });

  it('answers note titles in memory before the backend, without meeting notes', () => {
    const local = [
      { id: 'a', title: 'Backend plan', path: 'notes/a.md' },
      { id: 'b', title: 'The backend', path: 'notes/b.md' },
      { id: 'm', title: 'Backend sync notes', path: 'notes/session-m.md' },
      { id: 'c', title: 'Other', path: 'notes/c.md' },
    ];
    const groups = buildGroups('backend', local, null, now, 'Untitled');
    expect(kinds(groups)).toEqual(['notes']);
    expect(keys(groups, 'notes')).toEqual(['note-a', 'note-b']);
    expect(buildGroups('  ', local, null, now, 'Untitled')).toEqual([]);
  });

  it('merges backend notes with local titles, keeping the best tier and the snippet', () => {
    const answer: UniversalAnswer = {
      ...empty,
      notes: [
        { id: 'x', title: 'Plan', snippet: 'the backend ships', tier: 3, activity: true },
        { id: 'b', title: 'The backend', snippet: null, tier: 1, activity: false },
      ],
    };
    const groups = buildGroups('backend', [{ id: 'b', title: 'The backend' }], answer, now, '-');
    const notes = groups[0].items;
    expect(notes.map((n) => [n.key, n.tier])).toEqual([
      ['note-b', 1],
      ['note-x', 3],
    ]);
    expect(notes[1]).toMatchObject({ detail: 'the backend ships', activity: true });
  });

  it('splits transcript hits from meetings and keeps their time', () => {
    const answer: UniversalAnswer = {
      ...empty,
      meetings: [
        meeting('s1', 'Pulso', '2026-11-03T13:00:00Z', [
          { field: 'notes', snippet: 'decide the backend' },
          { field: 'transcript', snippet: 'Ana: the backend', atMs: 65_000 },
        ]),
        meeting('s2', 'Daily', '2026-10-01T09:00:00Z', [
          { field: 'transcript', snippet: 'Rui: backend again', atMs: 3_000 },
        ]),
      ],
    };
    const groups = buildGroups('backend', [], answer, now, '-');
    expect(kinds(groups)).toEqual(['meetings', 'transcripts']);
    expect(keys(groups, 'meetings')).toEqual(['session-s1']);
    const transcripts = groups.find((g) => g.kind === 'transcripts')!.items;
    expect(transcripts.map((t) => [t.key, t.atMs])).toEqual([
      ['transcript-s1', 65_000],
      ['transcript-s2', 3_000],
    ]);
    expect(transcripts[0].target).toEqual({ view: 'transcript', sessionId: 's1', find: 'backend' });
  });

  it('orders meetings by tier then closeness to now, events included', () => {
    const answer: UniversalAnswer = {
      ...empty,
      meetings: [
        meeting('far', 'Roadmap', '2026-01-01T10:00:00Z', [{ field: 'title', snippet: 'Roadmap' }]),
        meeting('near', 'Roadmap Q1', '2026-11-04T10:00:00Z', [
          { field: 'title', snippet: 'Roadmap Q1' },
        ]),
        meeting('person', 'Sync', '2026-11-03T12:30:00Z', [
          { field: 'people', snippet: 'Roadmap Bot' },
        ]),
      ],
      events: [
        meeting('e1', 'Roadmap review', '2026-11-03T15:00:00Z', [{ field: 'title', snippet: 'x' }]),
      ],
    };
    const groups = buildGroups('roadmap', [], answer, now, '-');
    expect(keys(groups, 'meetings')).toEqual([
      'event-e1',
      'session-near',
      'session-far',
      'session-person',
    ]);
    expect(groups[0].items[0].target).toEqual({ view: 'event', eventId: 'e1' });
  });

  it('orders kinds by their best tier and caps each kind', () => {
    const answer: UniversalAnswer = {
      ...empty,
      notes: Array.from({ length: 9 }, (_, i) => ({
        id: `n${i}`,
        title: `Note ${i}`,
        snippet: 'mariana said',
        tier: 3,
        activity: false,
      })),
      people: [
        { id: 'p1', name: 'Mariana Souto', alias: null, tier: 0 },
        { id: 'p2', name: 'Pedro', alias: 'Marinho', tier: 2 },
      ],
    };
    const groups = buildGroups('mari', [], answer, now, '-');
    expect(kinds(groups)).toEqual(['people', 'notes']);
    expect(groups[1].items).toHaveLength(PER_KIND);
    expect(groups[0].items[1]).toMatchObject({
      detail: 'Marinho',
      target: { view: 'person', personId: 'p2', name: 'Pedro' },
    });
    // Equal best tiers fall back to the fixed kind order.
    const tie = buildGroups(
      'x',
      [],
      { ...empty, notes: [answer.notes[0]], people: [{ ...answer.people[1], tier: 3 }] },
      now,
      '-'
    );
    expect(kinds(tie)).toEqual(['notes', 'people']);
  });

  it('marks matches ignoring accents and case', () => {
    expect(highlight('Revisão do Orçamento', 'orcamento')).toEqual([
      { text: 'Revisão do ', hit: false },
      { text: 'Orçamento', hit: true },
    ]);
    expect(highlight('abc', '')).toEqual([{ text: 'abc', hit: false }]);
  });
});
