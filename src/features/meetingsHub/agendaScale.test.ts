import { afterEach, describe, expect, it } from 'vitest';
import { minutesAt } from './gridSelect';
import { initialScroll, weekDays, weekStart } from './weekLayout';
import { gutterStyle } from './TimeGutter';

afterEach(() => {
  document.documentElement.style.removeProperty('font-size');
});

describe('agenda geometry follows the font size (spec 0125)', () => {
  const now = new Date(2026, 10, 3, 10, 30);
  const days = weekDays(weekStart(now));

  it('a pointer offset maps to the same minutes at any size', () => {
    expect(minutesAt(48)).toBe(60);
    document.documentElement.style.fontSize = '20px';
    expect(minutesAt(60)).toBe(60);
    document.documentElement.style.fontSize = '12px';
    expect(minutesAt(36)).toBe(60);
  });

  it('the axis opens on the same hour at any size', () => {
    expect(initialScroll(days, now)).toBe(9 * 48 - 10);
    document.documentElement.style.fontSize = '20px';
    expect(initialScroll(days, now)).toBe((9 * 48 - 10) * 1.25);
  });

  it('zone columns are in rem', () => {
    expect(gutterStyle(0)).toEqual({ '--mh-week-gutter': '3.25rem' });
    expect(gutterStyle(1)).toEqual({ '--mh-week-gutter': '4.25rem' });
  });
});
