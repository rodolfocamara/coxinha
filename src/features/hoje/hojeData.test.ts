import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../agenda/calendar';
import type { Board, BoardItem } from '../board/model';
import type { Session } from '../sessions/sessions';
import {
  formatDuration,
  greetingPeriod,
  mainAreaProgress,
  mergeAgenda,
  nextRow,
  previewCards,
  reviewGroups,
  rowAction,
  weekStats,
} from './hojeData';

// Friday 30 Oct 2026, 09:00 local.
const now = new Date(2026, 9, 30, 9, 0);
const at = (days: number, h: number, m = 0) =>
  new Date(2026, 9, 30 + days, h, m).toISOString().replace(/\.\d{3}Z$/, 'Z');

function session(o: Partial<Session> & { id: string }): Session {
  return {
    title: o.id,
    starts_at: null,
    ends_at: null,
    status: 'planned',
    origin: 'manual',
    meeting_id: null,
    personal_note: null,
    created_at: at(-1, 9),
    note_error: null,
    recording: null,
    transcript_status: 'none',
    processing_state: null,
    processing: null,
    ...o,
  };
}
const event = (o: Partial<CalendarEvent> & { id: string; startsAt: string }): CalendarEvent => ({
  title: o.id,
  endsAt: o.startsAt,
  cancelled: false,
  allDay: false,
  attendees: [],
  ...o,
});
const recording = (captureState: 'finished' | 'interrupted' | 'recording' = 'finished') => ({
  id: 'm',
  title: 'm',
  createdAt: at(-1, 9),
  captureState,
});

describe('greetingPeriod', () => {
  it.each([
    [6, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [23, 'evening'],
    [3, 'evening'],
  ])('at %ih is %s', (h, period) => {
    expect(greetingPeriod(new Date(2026, 9, 30, h, 0))).toBe(period);
  });
});

describe('mergeAgenda', () => {
  it('pairs an Outlook event with its session and orders the day by time', () => {
    const rows = mergeAgenda(
      [
        session({ id: 'weekly', title: 'Weekly de TI', starts_at: at(0, 10, 5), meeting_id: 'm1' }),
        session({ id: 'adhoc', title: 'Conversa rápida', starts_at: at(0, 8) }),
        session({ id: 'tomorrow', title: 'Amanhã', starts_at: at(1, 9) }),
        session({ id: 'dropped', title: 'Cancelada', starts_at: at(0, 11), status: 'cancelled' }),
      ],
      [
        event({ id: 'e-focus', title: 'Bloco de foco', startsAt: at(0, 16, 30) }),
        event({
          id: 'e-weekly',
          title: 'weekly de ti ',
          startsAt: at(0, 10),
          attendees: [
            { name: 'Rita', email: 'rita@x' },
            { name: 'Marcos', email: 'marcos@x' },
          ],
          organizer: { name: 'Rita', email: 'RITA@x' },
        }),
        event({ id: 'e-gone', title: 'Cancelado', startsAt: at(0, 12), cancelled: true }),
        event({
          id: 'e-holiday',
          title: 'Feriado',
          startsAt: at(0, 0),
          endsAt: at(1, 0),
          allDay: true,
        }),
        event({ id: 'e-later', title: 'Semana que vem', startsAt: at(5, 10) }),
      ],
      now
    );
    expect(rows.map((r) => r.key)).toEqual(['e:e-holiday', 's:adhoc', 's:weekly', 'e:e-focus']);
    const weekly = rows[2];
    expect(weekly.title).toBe('Weekly de TI');
    expect(weekly.event?.id).toBe('e-weekly');
    expect(weekly.people).toBe(2);
  });

  it('does not pair a same-titled session hours away from the event', () => {
    const rows = mergeAgenda(
      [session({ id: 's', title: 'Daily', starts_at: at(0, 15) })],
      [event({ id: 'e', title: 'Daily', startsAt: at(0, 9, 30) })],
      now
    );
    expect(rows.map((r) => r.key)).toEqual(['e:e', 's:s']);
  });

  it('dates a quick recording without schedule by its recording time', () => {
    const rows = mergeAgenda(
      [session({ id: 'q', recording: { ...recording(), createdAt: '2026-10-30 11:00:00' } })],
      [],
      now
    );
    expect(rows).toHaveLength(1);
  });

  it('finds the next row and picks the right action', () => {
    const rows = mergeAgenda(
      [
        session({ id: 'past', starts_at: at(0, 8), ends_at: at(0, 8, 30) }),
        session({ id: 'rec', starts_at: at(0, 8, 40), recording: recording() }),
        session({ id: 'soon', starts_at: at(0, 14) }),
      ],
      [event({ id: 'gone', startsAt: at(0, 7) }), event({ id: 'later', startsAt: at(0, 16) })],
      now
    );
    expect(nextRow(rows, now)?.key).toBe('s:soon');
    const action = Object.fromEntries(rows.map((r) => [r.key, rowAction(r, now)]));
    expect(action).toEqual({
      'e:gone': 'none',
      's:past': 'open',
      's:rec': 'open',
      's:soon': 'prepare',
      'e:later': 'prepare',
    });
  });
});

describe('reviewGroups', () => {
  it('counts failed transcriptions and recordings without transcript, newest first', () => {
    const groups = reviewGroups([
      session({
        id: 'failed',
        starts_at: at(-4, 15),
        processing_state: 'failed',
        recording: recording(),
      }),
      session({
        id: 'retrying',
        processing_state: 'failed',
        processing: { phase: 'x', meetingId: 'm' },
      }),
      session({ id: 'old', starts_at: at(-5, 9), recording: recording() }),
      session({ id: 'new', starts_at: at(-1, 9), recording: recording('interrupted') }),
      session({ id: 'live', starts_at: at(0, 9), recording: recording('recording') }),
      session({ id: 'done', recording: recording(), transcript_status: 'available' }),
      session({ id: 'queued', recording: recording(), processing_state: 'pending' }),
      session({ id: 'planned' }),
    ]);
    expect(groups.map((g) => [g.kind, g.sessions.map((s) => s.id)])).toEqual([
      ['failed', ['failed']],
      ['notx', ['new', 'old']],
    ]);
  });

  it('is empty when nothing needs review', () => {
    expect(reviewGroups([session({ id: 'a' })])).toEqual([]);
  });
});

describe('weekStats', () => {
  it('sums recorded time per weekday and shows today even on a weekend', () => {
    const saturday = new Date(2026, 9, 31, 10, 0);
    const stats = weekStats(
      [
        session({
          id: 'a',
          starts_at: at(-3, 10),
          ends_at: at(-3, 10, 45),
          recording: recording(),
          transcript_status: 'available',
        }),
        session({
          id: 'b',
          starts_at: at(0, 9),
          ends_at: at(0, 9, 30),
          recording: recording(),
          processing_state: 'failed',
        }),
        session({ id: 'no-audio', starts_at: at(0, 11), ends_at: at(0, 12) }),
        session({
          id: 'live',
          starts_at: at(1, 9),
          ends_at: at(1, 10),
          recording: recording('recording'),
        }),
        session({
          id: 'last-week',
          starts_at: at(-7, 9),
          ends_at: at(-7, 10),
          recording: recording(),
        }),
        session({ id: 'future', starts_at: at(2, 9) }),
      ],
      saturday
    );
    expect(stats.days.map((d) => d.key)).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
    ]);
    expect(stats.days.find((d) => d.isToday)?.key).toBe('2026-10-31');
    expect(stats.days[1].ms).toBe(45 * 60_000);
    expect(stats.totalMs).toBe(75 * 60_000);
    expect([stats.meetings, stats.transcribed, stats.failed]).toEqual([4, 1, 1]);
    expect(formatDuration(stats.totalMs)).toBe('1h 15min');
  });
});

describe('board preview', () => {
  const item = (o: Partial<BoardItem> & { id: string }): BoardItem => ({
    kind: 'card',
    x: 0,
    y: 0,
    width: 210,
    height: 96,
    color: 'neutral',
    label: o.id,
    noteId: `n-${o.id}`,
    notePath: null,
    ...o,
  });
  const board: Board = {
    version: 3,
    revision: 1,
    edges: [],
    items: [
      item({ id: 'area', kind: 'area', label: 'Migração do CRM', noteId: null }),
      item({ id: 'small', kind: 'area', label: 'LGPD', noteId: null }),
      item({ id: 'integ', x: 40, y: 92, progress: 100, parentId: 'area' }),
      item({ id: 'api', x: 300, y: 180, progress: 55, parentId: 'area' }),
      item({ id: 'rollback', x: 40, y: 228, progress: 20, parentId: 'area' }),
      item({ id: 'comm', x: 590, y: 92, progress: 0 }),
      item({ id: 'lgpd', x: 40, y: 520, progress: 100, parentId: 'small' }),
      item({ id: 'text', kind: 'text', x: 0, y: 0 }),
    ],
  };

  it('keeps up to four activity cards with their relative place', () => {
    const cards = previewCards(board);
    expect(cards.map((c) => c.item.id)).toEqual(['integ', 'comm', 'api', 'rollback']);
    expect(cards[0]).toMatchObject({ fx: 0, fy: 0 });
    expect(cards[1]).toMatchObject({ fx: 1, fy: 0 });
    expect(cards[3]).toMatchObject({ fx: 0, fy: 1 });
  });

  it('reports the area with most activities and its average progress', () => {
    expect(mainAreaProgress(board)).toEqual({ label: 'Migração do CRM', pct: 58 });
    expect(
      mainAreaProgress({ ...board, items: board.items.filter((i) => i.kind !== 'area') })
    ).toBeNull();
  });
});
