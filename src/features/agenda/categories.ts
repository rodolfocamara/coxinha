import type { CSSProperties } from 'react';
import { create } from 'zustand';
import {
  calendar,
  type CalendarEvent,
  type CalendarSnapshot,
  type CategoryAccess,
  type OutlookCategory,
} from './calendar';

/** Outlook's colour names for presets 0–24 (Microsoft Graph `outlookCategory`). */
export const OUTLOOK_PRESETS = [
  'red',
  'orange',
  'brown',
  'yellow',
  'green',
  'teal',
  'olive',
  'blue',
  'purple',
  'cranberry',
  'steel',
  'darkSteel',
  'gray',
  'darkGray',
  'black',
  'darkRed',
  'darkOrange',
  'darkBrown',
  'darkYellow',
  'darkGreen',
  'darkTeal',
  'darkOlive',
  'darkBlue',
  'darkPurple',
  'darkCranberry',
] as const;

type Edit = { categories: string[]; saved: boolean; token: number };
type State = {
  master: OutlookCategory[];
  /** Null while Outlook is not connected. */
  access: CategoryAccess | null;
  /** Optimistic category lists by event ID, until a reloaded snapshot replaces them. */
  edits: Record<string, Edit>;
};

export const useOutlookCategories = create<State>(() => ({ master: [], access: null, edits: {} }));

export function resetOutlookCategories() {
  useOutlookCategories.setState({ master: [], access: null, edits: {} });
}

/** Called with every snapshot read; saved edits are now in the snapshot itself. */
export function publishCategories(snapshot: CalendarSnapshot) {
  useOutlookCategories.setState((state) => ({
    master: snapshot.categories ?? [],
    access: snapshot.account ? (snapshot.categoryAccess ?? { read: false, write: false }) : null,
    edits: Object.fromEntries(Object.entries(state.edits).filter(([, edit]) => !edit.saved)),
  }));
}

const same = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

export type CategoryColour = { name: string; preset: number };

/** The event's colour: its first category that has a colour in the master list. */
export function primaryCategory(
  names: string[] | undefined,
  master: OutlookCategory[]
): CategoryColour | null {
  for (const name of names ?? []) {
    const found = master.find((category) => same(category.name, name));
    if (
      found &&
      found.preset !== null &&
      found.preset >= 0 &&
      found.preset < OUTLOOK_PRESETS.length
    )
      return { name: found.name, preset: found.preset };
  }
  return null;
}

export function presetOf(name: string, master: OutlookCategory[]) {
  return master.find((category) => same(category.name, name))?.preset ?? null;
}

/** Category names of an event, following an unsaved or just-saved change. */
export function useEventCategories(event: CalendarEvent | null | undefined): string[] {
  const edit = useOutlookCategories((s) => (event ? s.edits[event.id] : undefined));
  return edit?.categories ?? event?.categories ?? [];
}

export function useEventColour(event: CalendarEvent | null | undefined): CategoryColour | null {
  const names = useEventCategories(event);
  const master = useOutlookCategories((s) => s.master);
  return event ? primaryCategory(names, master) : null;
}

export const colourVar = (preset: number) => `var(--outlook-cat-${preset})`;
export const fillVar = (preset: number) => `var(--outlook-cat-${preset}-bg)`;

/** Custom properties for an element painted with a category (bar and fill). */
export function colourStyle(preset: number) {
  return { '--cx-cat': colourVar(preset), '--cx-cat-bg': fillVar(preset) } as CSSProperties;
}

/** Props for an element painted as a category block (`.cx-cat-mark`). */
export function markProps(colour: CategoryColour | null) {
  if (!colour) return {};
  return { 'data-category': OUTLOOK_PRESETS[colour.preset], style: colourStyle(colour.preset) };
}

let nextToken = 0;

/** Optimistic: the colour changes at once and rolls back if Outlook refuses. */
export async function changeEventCategories(eventId: string, categories: string[]) {
  const token = ++nextToken;
  const set = (edit: Edit | null) =>
    useOutlookCategories.setState((state) => {
      if (state.edits[eventId] && state.edits[eventId].token !== token) return state;
      const edits = { ...state.edits };
      if (edit) edits[eventId] = edit;
      else delete edits[eventId];
      return { edits };
    });
  useOutlookCategories.setState((state) => ({
    edits: { ...state.edits, [eventId]: { categories, saved: false, token } },
  }));
  try {
    await calendar.setCategories(eventId, categories);
    set({ categories, saved: true, token });
  } catch (error) {
    set(null);
    throw error;
  }
}
