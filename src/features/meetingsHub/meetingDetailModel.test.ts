import { expect, it } from 'vitest';
import {
  groupStartsOpen,
  memoryState,
  panelState,
  relativeLabel,
  speakersValue,
} from './meetingDetailModel';
import i18n from '../../lib/i18n';
import type { MeetingRow } from './meetingRows';

const now = new Date(2026, 10, 3, 12);
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

it.each([
  [later(25), 'in 25 minutes'],
  [later(-25), '25 minutes ago'],
  [later(59), 'in 59 minutes'],
  [later(120), 'in 2 hours'],
  [later(-90), '2 hours ago'],
  [new Date(2026, 10, 4, 9), 'tomorrow'],
  [new Date(2026, 10, 2, 16), 'yesterday'],
  [new Date(2026, 10, 8, 9), 'in 5 days'],
  [new Date(2026, 9, 30, 9), '4 days ago'],
  [new Date(2026, 11, 1, 9), 'in 4 weeks'],
])('relative time %#', (date, text) => {
  expect(relativeLabel(date, now, 'en')).toBe(text);
});

it('words relative time in the language of the app', () => {
  expect(relativeLabel(later(120), now, 'pt-BR')).toBe('em 2 horas');
  expect(relativeLabel(new Date(2026, 10, 4, 9), now, 'pt-BR')).toBe('amanhã');
});

const row = (start: Date | null, end: Date | null) =>
  ({ kind: 'event', key: 'k', title: 't', start, end }) as MeetingRow;

it('tells upcoming, under way and past apart', () => {
  expect(panelState(row(later(30), later(60)), now, false)).toBe('upcoming');
  expect(panelState(row(later(-30), later(30)), now, false)).toBe('now');
  expect(panelState(row(later(-60), later(-30)), now, false)).toBe('past');
  expect(panelState(row(later(-60), later(-30)), now, true)).toBe('past');
  // A recording has a start and no end: it is over once it exists.
  expect(panelState(row(later(-60), null), now, true)).toBe('past');
  expect(panelState(row(later(-60), null), now, false)).toBe('upcoming');
  expect(panelState(row(null, null), now, false)).toBe('upcoming');
});

it('opens short lists, and only those who accepted of a long upcoming one', () => {
  expect(groupStartsOpen('noAnswer', 3, 8, false)).toBe(true);
  expect(groupStartsOpen('noAnswer', 3, 8, true)).toBe(true);
  expect(groupStartsOpen('accepted', 3, 9, false)).toBe(true);
  expect(groupStartsOpen('accepted', 9, 40, false)).toBe(false);
  expect(groupStartsOpen('noAnswer', 3, 9, false)).toBe(false);
  expect(groupStartsOpen('accepted', 3, 9, true)).toBe(false);
});

it('says how many speakers there are and whether naming is left to do', async () => {
  const t = i18n.t.bind(i18n);
  await i18n.changeLanguage('en');
  expect(speakersValue({ named: 0, unnamed: 6 }, t)).toBe('6 · none named');
  expect(speakersValue({ named: 1, unnamed: 3 }, t)).toBe('4 · 1 named');
  expect(speakersValue({ named: 3, unnamed: 1 }, t)).toBe('4 · 3 named');
  expect(speakersValue({ named: 2, unnamed: 0 }, t)).toBe('2 · all named');
  expect(speakersValue({ named: 1, unnamed: 0 }, t)).toBe('1 · named');
  await i18n.changeLanguage('pt-BR');
  expect(speakersValue({ named: 0, unnamed: 6 }, t)).toBe('6 · nenhum nomeado');
  await i18n.changeLanguage('en');
});

it.each([
  [{ summary: true, transcript: true }, true, 'memoryKept'],
  [{ summary: true, transcript: false }, false, 'memoryKept'],
  [{ summary: false, transcript: true }, false, 'memoryOff'],
  [{ summary: false, transcript: true }, true, 'memoryPending'],
  [{ summary: false, transcript: false }, true, 'memoryNoTranscript'],
] as const)('tells what memory holds of a meeting %#', (signals, summariesOn, state) => {
  expect(memoryState(signals, summariesOn)).toBe(state);
});
