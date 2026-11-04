import { expect, it } from 'vitest';
import type { MeetingSignals } from '../meetings/library';
import { lacksPreparation, presentSignals, signalItems } from './meetingSignals';
import type { MeetingRow } from './meetingRows';
import { event, recording, session } from './meetingsHub.fixtures';

const now = new Date('2026-11-03T12:00:00Z');
const future = new Date('2026-11-04T12:00:00Z');
const past = new Date('2026-11-02T12:00:00Z');
const invited = [{ name: 'Ana', email: null }];

const signals = (o: Partial<MeetingSignals> = {}): MeetingSignals => ({
  sessionId: 's',
  transcript: false,
  speakers: { named: 0, unnamed: 0 },
  note: false,
  preparation: false,
  diagram: false,
  summary: false,
  followUps: { linked: 0, actions: 0 },
  generatedContent: false,
  mark: null,
  ...o,
});
const eventRow = (o: Parameters<typeof event>[0], start = future): MeetingRow => ({
  kind: 'event',
  key: 'e',
  title: o.title,
  start,
  end: null,
  event: event({ attendees: invited, ...o }),
});
const sessionRow = (start: Date | null): MeetingRow => ({
  kind: 'session',
  key: 's',
  title: 'x',
  start,
  end: null,
  session: session({ id: 's', title: 'x' }),
  event: null,
});

it('lists what the meeting has, the mark first and nothing it lacks', () => {
  expect(presentSignals(undefined)).toEqual([]);
  expect(presentSignals(signals())).toEqual([]);
  const all = signals({
    mark: 'useful',
    transcript: true,
    speakers: { named: 1, unnamed: 2 },
    note: true,
    preparation: true,
    diagram: true,
    summary: true,
    followUps: { linked: 1, actions: 0 },
  });
  expect(presentSignals(all).map((item) => item.id)).toEqual([
    'useful',
    'transcript',
    'speakers',
    'note',
    'preparation',
    'diagram',
    'memory',
    'followUps',
  ]);
  expect(presentSignals(all)[2]).toEqual({ id: 'speakers', named: 1, unnamed: 2 });
});

it('memory is the summary, and generated content alone never reads as useful', () => {
  const ids = (o: Partial<MeetingSignals>) => presentSignals(signals(o)).map((item) => item.id);
  expect(ids({ transcript: true, note: true })).not.toContain('memory');
  expect(ids({ summary: true })).toEqual(['memory']);
  expect(ids({ generatedContent: true, summary: true, note: true })).not.toContain('useful');
});

it('marks a future meeting without preparation', () => {
  expect(lacksPreparation(eventRow({ id: 'e', title: 'x' }), undefined, now)).toBe(true);
  expect(lacksPreparation(sessionRow(future), signals(), now)).toBe(true);
  expect(signalItems(sessionRow(future), signals(), now).map((i) => i.id)).toEqual([
    'noPreparation',
  ]);
});

it('never asks to prepare what is prepared, over, or not a meeting', () => {
  expect(lacksPreparation(sessionRow(future), signals({ preparation: true }), now)).toBe(false);
  // While signals load, a session stays quiet rather than flashing the mark.
  expect(lacksPreparation(sessionRow(future), undefined, now)).toBe(false);
  expect(lacksPreparation(sessionRow(past), signals(), now)).toBe(false);
  expect(lacksPreparation(sessionRow(null), signals(), now)).toBe(false);
  expect(lacksPreparation(eventRow({ id: 'e', title: 'x' }, past), undefined, now)).toBe(false);
  for (const o of [
    { allDay: true },
    { cancelled: true },
    { attendees: [] },
    { response: 'declined' as const },
    { showAs: 'free' as const },
  ])
    expect(
      lacksPreparation(eventRow({ id: 'e', title: 'x', ...o }), undefined, now),
      String(Object.keys(o))
    ).toBe(false);
  const orphan: MeetingRow = {
    kind: 'recording',
    key: 'r',
    title: 'x',
    start: future,
    end: null,
    recording: recording('r', 'x'),
  };
  expect(lacksPreparation(orphan, undefined, now)).toBe(false);
});
