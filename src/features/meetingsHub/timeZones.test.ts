import { beforeEach, expect, it } from 'vitest';
import { MAX_ZONES, resetTimeZones, useTimeZones, zoneHour, zoneLabel } from './timeZones';

const KEY = 'coxinha:calendar-time-zones';
const ids = () => useTimeZones.getState().zones.map((z) => z.id);

beforeEach(() => {
  window.localStorage.clear();
  resetTimeZones();
});

it('starts without extra zones and adds, reorders and removes them, persisted locally', () => {
  const { add, move, remove } = useTimeZones.getState();
  expect(ids()).toEqual([]);
  expect(add('Asia/Jerusalem', ' IL ')).toBe(true);
  expect(add('America/Mexico_City', 'MX')).toBe(true);
  expect(useTimeZones.getState().zones[0]).toEqual({ id: 'Asia/Jerusalem', label: 'IL' });
  move('America/Mexico_City', -1);
  expect(ids()).toEqual(['America/Mexico_City', 'Asia/Jerusalem']);
  move('America/Mexico_City', -1);
  expect(ids()).toEqual(['America/Mexico_City', 'Asia/Jerusalem']);
  remove('America/Mexico_City');
  expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual([
    { id: 'Asia/Jerusalem', label: 'IL' },
  ]);
  // A fresh start reads the saved list.
  useTimeZones.setState({ zones: [] });
  resetTimeZones();
  expect(ids()).toEqual(['Asia/Jerusalem']);
});

it('refuses unknown or repeated zones and more than the limit', () => {
  const { add } = useTimeZones.getState();
  expect(add('Mars/Olympus_Mons', 'MA')).toBe(false);
  expect(add('', '')).toBe(false);
  expect(add('Asia/Tokyo', 'JP')).toBe(true);
  expect(add('Asia/Tokyo', 'JP2')).toBe(false);
  expect(add('Europe/Lisbon', 'PT')).toBe(true);
  expect(add('America/New_York', 'NY')).toBe(true);
  expect(ids()).toHaveLength(MAX_ZONES);
  expect(add('Australia/Sydney', 'AU')).toBe(false);
});

it('ignores a corrupted saved list and trims labels', () => {
  window.localStorage.setItem(
    KEY,
    JSON.stringify([{ id: 'Nowhere/Land' }, { id: 'Asia/Tokyo', label: 'TOKYO-JAPAN' }, 3])
  );
  resetTimeZones();
  expect(useTimeZones.getState().zones).toEqual([{ id: 'Asia/Tokyo', label: 'TOKYO-' }]);
  window.localStorage.setItem(KEY, '{broken');
  resetTimeZones();
  expect(ids()).toEqual([]);
});

it('shows the wall time of each zone at the same instant, with minutes off the hour', () => {
  const instant = new Date(Date.UTC(2026, 10, 3, 19, 0));
  expect(zoneHour(instant, 'en', 'UTC')).toBe('19');
  expect(zoneHour(instant, 'en', 'Asia/Kolkata')).toBe('00:30');
  expect(zoneHour(instant, 'en', 'America/Sao_Paulo')).toBe('16');
  expect(zoneLabel({ id: 'Asia/Jerusalem', label: 'IL' }, instant, 'en')).toBe('IL');
  expect(zoneLabel({ id: 'Etc/GMT-2', label: '' }, instant, 'en')).toBe('GMT+2');
});
