import { changeControl } from '../../test/changeControl';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import i18n from '../../lib/i18n';
import { CalendarToolbar } from './CalendarToolbar';
import { useSessionNavigation } from './sessionNavigation';
import { localDay } from './sessionDates';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  useSessionNavigation.setState({
    calendarPeriod: { kind: 'all' },
    transcript: 'all',
    month: localDay(2026, 9, 1),
    selectedDay: null,
    view: 'month',
  });
});
afterEach(cleanup);

it('keeps filters on one bottom-aligned row with shared 36px controls and no spacing hacks', () => {
  const { container } = render(<CalendarToolbar />);
  const filters = screen.getByRole('group', { name: 'Calendar filters' });
  expect(filters).toHaveClass('flex', 'flex-wrap', 'items-end');
  expect(filters).not.toHaveClass('items-start');
  expect(container.querySelector('.mt-6, [class*=" mt-6"]')).toBeNull();
  for (const name of ['Calendar period', 'Transcript coverage']) {
    const select = within(filters).getByRole('combobox', { name });
    expect(select).toHaveAttribute('data-size', 'md');
    expect(select).toHaveAttribute('data-block', 'true');
  }
  const reset = within(filters).getByRole('button', { name: 'Reset filters' });
  expect(reset).toHaveClass('cx-btn');
  expect(reset).toHaveAttribute('data-size', 'md');
});

it('separates the month title and navigation from the filter row', () => {
  render(<CalendarToolbar />);
  const filters = screen.getByRole('group', { name: 'Calendar filters' });
  const title = screen.getByRole('heading', { level: 2, name: 'October 2026' });
  expect(filters).not.toContainElement(title);
  for (const name of ['Previous month', 'Today', 'Next month'])
    expect(screen.getByRole('button', { name })).toHaveAttribute('data-size', 'sm');
  const view = screen.getByRole('group', { name: 'Calendar view' });
  expect(within(view).getAllByRole('button')).toHaveLength(2);
});

it('opens the custom range as its own bottom-aligned row with primary Apply and ghost Cancel', () => {
  render(<CalendarToolbar />);
  const filters = screen.getByRole('group', { name: 'Calendar filters' });
  changeControl(within(filters).getByRole('combobox', { name: 'Calendar period' }), {
    target: { value: 'custom' },
  });
  const from = screen.getByLabelText('From');
  const row = from.closest('.flex-wrap');
  expect(row).toHaveClass('items-end');
  expect(from.closest('form')).toHaveClass('order-last', 'basis-full');
  expect(from).toHaveAttribute('data-size', 'sm');
  expect(screen.getByLabelText('Through (inclusive)')).toHaveAttribute('data-size', 'sm');
  const apply = screen.getByRole('button', { name: 'Apply dates' });
  expect(apply).toHaveAttribute('data-variant', 'primary');
  expect(apply).toHaveAttribute('data-size', 'sm');
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('data-variant', 'ghost');
});
