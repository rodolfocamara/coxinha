import { describe, expect, it } from 'vitest';
import {
  attentionOf,
  buildRows,
  groupRows,
  matchEvent,
  matchesSearch,
  needsReview,
  rowsByDay,
  type MeetingRow,
} from './meetingRows';
import { buildLanes } from './lanes';
import { at, event, recording, session } from './meetingsHub.fixtures';
import type { ProcessingReport } from '../meetings/library';

const keys = (rows: MeetingRow[]) => rows.map((r) => r.key);

describe('merge of sessions, Outlook events and recordings', () => {
  it('lets a session claim its Outlook event and its recording, keeping the rest', () => {
    const weekly = session({
      id: 's1',
      title: 'Weekly de TI',
      starts_at: at(0, 10, 5),
      meeting_id: 'm1',
      recording: recording('m1', 'Weekly de TI'),
    });
    const rows = buildRows(
      [weekly],
      [
        event({ id: 'e1', title: 'weekly de ti', startsAt: at(0, 10), endsAt: at(0, 11) }),
        event({ id: 'e2', title: 'Comitê', startsAt: at(0, 14), endsAt: at(0, 15) }),
      ],
      [recording('m1', 'Weekly de TI'), recording('m2', 'Imported interview')]
    );
    expect(keys(rows).sort()).toEqual(['e:e2', 'r:m2', 's:s1']);
    const merged = rows.find((r) => r.key === 's:s1');
    expect(merged?.kind === 'session' && merged.event?.id).toBe('e1');
  });

  it('does not match an event with the same title far from the session start', () => {
    const s = session({ id: 's1', title: 'Daily', starts_at: at(0, 9) });
    expect(matchEvent(s, [event({ id: 'e', title: 'Daily', startsAt: at(0, 11) })])).toBeNull();
    expect(
      matchEvent(session({ id: 'u', title: 'Daily' }), [event({ id: 'e', title: 'Daily' })])
    ).toBeNull();
  });
});

describe('grouping', () => {
  const now = new Date();
  const rows = buildRows(
    [
      session({ id: 'past', title: 'Past', starts_at: at(-3, 9) }),
      session({ id: 'undated', title: 'Undated manual meeting' }),
      session({ id: 'today', title: 'Later today', starts_at: at(0, 23, 50) }),
      session({ id: 'live', title: 'Live one', starts_at: at(-1, 8) }),
    ],
    [event({ id: 'next', title: 'Roadmap', startsAt: at(3, 9), endsAt: at(3, 10) })],
    [recording('loose', 'Loose recording', 'finished', '2026-01-02 10:00:00')]
  );
  const groups = groupRows(rows, now, (row) => row.key === 's:live');

  it('places live meetings under Agora and keeps undated ones reachable under Anteriores', () => {
    const byId = Object.fromEntries(groups.map((g) => [g.id, keys(g.rows)]));
    expect(byId.now).toEqual(['s:live']);
    expect(byId.upcoming).toEqual(['e:next']);
    expect(byId.earlier).toEqual(['s:past', 'r:loose', 's:undated']);
    expect(groups.map((g) => g.id)).toEqual(
      now.getHours() === 23 && now.getMinutes() >= 50
        ? ['now', 'upcoming', 'earlier']
        : ['now', 'today', 'upcoming', 'earlier']
    );
  });

  it('places an event happening right now under Agora', () => {
    const current = buildRows(
      [],
      [
        event({
          id: 'n',
          title: 'Now',
          startsAt: new Date(Date.now() - 600_000).toISOString(),
          endsAt: new Date(Date.now() + 600_000).toISOString(),
        }),
      ],
      []
    );
    expect(groupRows(current, new Date(), () => false)[0].id).toBe('now');
  });

  it('places meetings on local calendar days for the month grid', () => {
    const days = rowsByDay(rows);
    expect([...days.values()].flat().some((r) => r.key === 's:undated')).toBe(false);
    expect(days.size).toBeGreaterThanOrEqual(4);
  });
});

describe('A revisar', () => {
  const row = (o: Parameters<typeof session>[0]) => buildRows([session(o)], [], [])[0];
  it('flags interrupted capture, failed transcription and missing transcript, never a live one', () => {
    const interrupted = row({
      id: 'a',
      title: 'a',
      meeting_id: 'm',
      recording: recording('m', 'a', 'interrupted'),
    });
    const failed = row({
      id: 'b',
      title: 'b',
      meeting_id: 'm',
      recording: recording('m', 'b'),
      processing_state: 'failed',
      transcript_status: 'unavailable',
    });
    const missing = row({ id: 'c', title: 'c', meeting_id: 'm', recording: recording('m', 'c') });
    const done = row({
      id: 'd',
      title: 'd',
      meeting_id: 'm',
      recording: recording('m', 'd'),
      transcript_status: 'available',
      processing_state: 'failed',
    });
    const planned = row({ id: 'e', title: 'e' });
    expect(attentionOf(interrupted, false)).toBe('recover');
    expect(attentionOf(interrupted, true)).toBeNull();
    expect(attentionOf(failed, false)).toBe('failed');
    expect(attentionOf(missing, false)).toBe('untranscribed');
    // A later failed job never hides an earlier saved transcript.
    expect(attentionOf(done, false)).toBeNull();
    expect(attentionOf(planned, false)).toBeNull();
    expect(
      [interrupted, failed, missing, done, planned].filter((r) =>
        needsReview(attentionOf(r, false))
      ).length
    ).toBe(3);
  });
});

it('searches title and invitees without accents or case', () => {
  const [row] = buildRows(
    [],
    [
      event({
        id: 'e',
        title: 'Comitê de produto',
        attendees: [{ name: 'Juliana Alves', email: 'ju@example.com' }],
      }),
    ],
    []
  );
  expect(matchesSearch(row, 'comite')).toBe(true);
  expect(matchesSearch(row, 'JULIANA')).toBe(true);
  expect(matchesSearch(row, 'ju@example')).toBe(true);
  expect(matchesSearch(row, 'marcos')).toBe(false);
});

it('builds speaker lanes with shares, positions and speakers still to confirm', () => {
  const report: ProcessingReport = {
    job: 'j',
    turns: [
      { id: '1', track: 'mic', speaker: 'S0', start_ms: 0, end_ms: 30_000 },
      { id: '2', track: 'output', speaker: 'S1', start_ms: 30_000, end_ms: 90_000 },
      { id: '3', track: 'output', speaker: 'unknown', start_ms: 90_000, end_ms: 95_000 },
      { id: '4', track: 'output', speaker: 'S2', start_ms: 95_000, end_ms: 100_000 },
    ],
    segments: [],
    warnings: [],
    corrections: {},
    assignments: [
      { id: 'a', speaker: 'S0', track: 'mic', person_id: 'p', state: 'confirmed', name: 'Rodolfo' },
      { id: 'b', speaker: 'S1', track: 'output', person_id: 'q', state: 'suggested', name: 'Rita' },
    ],
  };
  const { lanes, totalMs, unconfirmed } = buildLanes(report, 120_000);
  expect(totalMs).toBe(120_000);
  expect(lanes.map((l) => [l.name, l.share])).toEqual([
    ['Rodolfo', 32],
    [null, 63],
    [null, 5],
  ]);
  expect(lanes[1].segments[0]).toMatchObject({ left: 25, width: 50 });
  expect(unconfirmed).toBe(2);
  expect(buildLanes(null).lanes).toEqual([]);
});
