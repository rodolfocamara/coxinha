import { expect, it } from 'vitest';
import { event } from './meetingsHub.fixtures';
import { matchCandidates } from './peekMatch';

const t = (h: number, m = 0) => new Date(2026, 9, 30, h, m).toISOString();

it('puts the proposal first, then nearby events by overlap, without cancelled or all-day ones', () => {
  const events = [
    event({ id: 'far', title: 'Far', startsAt: t(14), endsAt: t(15) }),
    event({ id: 'short', title: 'Short', startsAt: t(11, 15), endsAt: t(11, 30) }),
    event({ id: 'long', title: 'Long', startsAt: t(11), endsAt: t(12) }),
    event({ id: 'gone', title: 'Gone', startsAt: t(11), endsAt: t(12), cancelled: true }),
    event({ id: 'day', title: 'Day', startsAt: t(0), endsAt: t(23, 59), allDay: true }),
    event({ id: 'before', title: 'Before', startsAt: t(10), endsAt: t(11) }),
    event({ id: 'proposed', title: 'Proposed', startsAt: t(11), endsAt: t(11, 30) }),
  ];
  const proposal = events.find((e) => e.id === 'proposed')!;
  const ids = (list: { id: string }[]) => list.map((e) => e.id);
  expect(ids(matchCandidates(events, new Date(t(11, 20)), 27 * 60_000, proposal))).toEqual([
    'proposed',
    'long',
    'short',
    'before',
  ]);
  expect(ids(matchCandidates(events, new Date(t(18)), null, null))).toEqual([]);
});
