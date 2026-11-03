import { create } from 'zustand';

/** An extra time zone column in the week gutter (spec 0119 P4), as in Outlook. */
export type ExtraZone = { id: string; label: string };

const KEY = 'coxinha:calendar-time-zones';
const LOCAL_KEY = 'coxinha:calendar-local-zone-label';
export const MAX_ZONES = 3;
export const MAX_LABEL = 6;

export function validZone(id: string) {
  if (!id.trim()) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: id.trim() });
    return true;
  } catch {
    return false;
  }
}

function clean(value: unknown): ExtraZone[] {
  if (!Array.isArray(value)) return [];
  const zones: ExtraZone[] = [];
  for (const item of value) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    const label = typeof item?.label === 'string' ? item.label.trim().slice(0, MAX_LABEL) : '';
    if (validZone(id) && !zones.some((z) => z.id === id)) zones.push({ id, label });
  }
  return zones.slice(0, MAX_ZONES);
}

function read(): ExtraZone[] {
  if (typeof window === 'undefined') return [];
  try {
    return clean(JSON.parse(window.localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return [];
  }
}

function readLocal() {
  if (typeof window === 'undefined') return '';
  return (window.localStorage.getItem(LOCAL_KEY) ?? '').trim().slice(0, MAX_LABEL);
}

type State = {
  zones: ExtraZone[];
  /** The owner's name for this computer's zone; empty uses the short zone name. */
  localLabel: string;
  setLocalLabel: (label: string) => void;
  /** False when the zone is unknown, already listed, or the list is full. */
  add: (id: string, label: string) => boolean;
  remove: (id: string) => void;
  move: (id: string, by: -1 | 1) => void;
};

function save(zones: ExtraZone[]) {
  if (typeof window !== 'undefined') window.localStorage.setItem(KEY, JSON.stringify(zones));
  return { zones };
}

export const useTimeZones = create<State>((set, get) => ({
  zones: read(),
  localLabel: readLocal(),
  setLocalLabel: (label) => {
    const localLabel = label.trim().slice(0, MAX_LABEL);
    if (typeof window !== 'undefined') window.localStorage.setItem(LOCAL_KEY, localLabel);
    set({ localLabel });
  },
  add: (id, label) => {
    const zones = get().zones;
    const next = clean([...zones, { id, label }]);
    if (next.length === zones.length) return false;
    set(save(next));
    return true;
  },
  remove: (id) => set(save(get().zones.filter((z) => z.id !== id))),
  move: (id, by) => {
    const zones = [...get().zones];
    const from = zones.findIndex((z) => z.id === id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= zones.length) return;
    [zones[from], zones[to]] = [zones[to], zones[from]];
    set(save(zones));
  },
}));

export function resetTimeZones() {
  useTimeZones.setState({ zones: read(), localLabel: readLocal() });
}

/** The column heading: the owner's label, else the zone's short name ("GMT+2"). */
export function zoneLabel(zone: ExtraZone, at: Date, locale: string) {
  return zone.label || shortName(at, locale, zone.id);
}

export function shortName(at: Date, locale: string, timeZone?: string) {
  const part = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone ?? '';
}

/** The zone's wall time at a local instant: "18", or "18:30" off the hour. */
export function zoneHour(at: Date, locale: string, timeZone?: string) {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return minute === '00' ? hour : `${hour}:${minute}`;
}
