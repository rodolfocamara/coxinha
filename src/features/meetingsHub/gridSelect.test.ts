import { describe, expect, it } from 'vitest';
import { atMinutes, minutesAt, selection } from './gridSelect';

describe('selection', () => {
  it('snaps a click to the half hour for 30 minutes', () => {
    expect(selection(9 * 60 + 40, 9 * 60 + 40, false)).toEqual({ from: 570, to: 600 });
    expect(selection(14 * 60 + 5, 0, false)).toEqual({ from: 840, to: 870 });
  });

  it('snaps a drag to 15 minutes in either direction with a 15-minute minimum', () => {
    expect(selection(9 * 60 + 5, 10 * 60 + 20, true)).toEqual({ from: 540, to: 630 });
    expect(selection(10 * 60 + 20, 9 * 60 + 5, true)).toEqual({ from: 540, to: 630 });
    expect(selection(600, 600, true)).toEqual({ from: 600, to: 615 });
    expect(selection(605, 610, true)).toEqual({ from: 600, to: 615 });
  });

  it('never runs past 23:59', () => {
    expect(selection(23 * 60 + 50, 23 * 60 + 50, false)).toEqual({ from: 1410, to: 1439 });
    expect(selection(23 * 60, 1439, true)).toEqual({ from: 1380, to: 1439 });
    expect(selection(1439, 1439, true)).toEqual({ from: 1425, to: 1439 });
  });
});

describe('minutesAt and atMinutes', () => {
  it('maps the 48 px hour to minutes and back to a local time', () => {
    expect(minutesAt(48 * 9 + 24)).toBe(570);
    expect(minutesAt(-10)).toBe(0);
    expect(minutesAt(48 * 30)).toBe(1439);
    const at = atMinutes(new Date(2026, 10, 4), 570);
    expect([at.getDate(), at.getHours(), at.getMinutes()]).toEqual([4, 9, 30]);
  });
});
