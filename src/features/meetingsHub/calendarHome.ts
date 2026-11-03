import { create } from 'zustand';
import { localDay, nextDay } from '../sessions/sessionDates';
import { primaryCategory } from '../agenda/categories';
import type { OutlookCategory } from '../agenda/calendar';
import type { MeetingRow } from './meetingRows';
import { isAllDay } from './weekLayout';

/** Key of meetings without a coloured category in the rail's filter. */
export const NO_CATEGORY = '';
const HIDDEN_KEY = 'coxinha:calendar-hidden-categories';

function readHidden(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

type HomeState = {
  /** Where the calendar looks; kept while a meeting is open so "← Agenda" returns there. */
  anchor: Date | null;
  hidden: string[];
  /** The search, kept like the anchor so coming back shows the same results. */
  query: string;
  setAnchor: (anchor: Date) => void;
  setQuery: (query: string) => void;
  toggleCategory: (name: string) => void;
};

export const useCalendarHome = create<HomeState>((set) => ({
  anchor: null,
  hidden: readHidden(),
  query: '',
  setAnchor: (anchor) => set({ anchor }),
  setQuery: (query) => set({ query }),
  toggleCategory: (name) =>
    set((state) => {
      const hidden = state.hidden.includes(name)
        ? state.hidden.filter((h) => h !== name)
        : [...state.hidden, name];
      if (typeof window !== 'undefined')
        window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
      return { hidden };
    }),
}));

export function resetCalendarHome() {
  useCalendarHome.setState({ anchor: null, hidden: [], query: '' });
}

const categoriesOf = (row: MeetingRow) => (row.kind === 'recording' ? [] : row.event?.categories);

/** The rail's filter: a row follows its first coloured category, else "no category". */
export function categoryKey(row: MeetingRow, master: OutlookCategory[]) {
  return primaryCategory(categoriesOf(row), master)?.name ?? NO_CATEGORY;
}

export function visibleRows(rows: MeetingRow[], hidden: string[], master: OutlookCategory[]) {
  if (!hidden.length) return rows;
  return rows.filter((row) => !hidden.includes(categoryKey(row, master)));
}

const timed = (row: MeetingRow) =>
  !!row.start && !isAllDay(row) && !(row.kind !== 'recording' && row.event?.cancelled);

/**
 * "Agora / A seguir" (spec 0107): the live meeting, else one in progress; and
 * the next one still today.
 */
export function nowAndNext(rows: MeetingRow[], now: Date, isLive: (row: MeetingRow) => boolean) {
  const byStart = rows
    .filter(timed)
    .sort((a, b) => a.start!.getTime() - b.start!.getTime() || a.key.localeCompare(b.key));
  const current =
    rows.find(isLive) ??
    byStart.find((row) => row.start! <= now && !!row.end && now < row.end) ??
    null;
  const endOfDay = nextDay(localDay(now.getFullYear(), now.getMonth(), now.getDate()));
  const next =
    byStart.find((row) => row !== current && row.start! > now && row.start! < endOfDay) ?? null;
  return { current, next };
}
