import { rem } from '../../lib/appearance/units';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Outlet } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { at, backend, event, freshDb, renderAt, resetState, type Db } from './meetingsHub.harness';

vi.mock('../../routes/__root', () => ({ RootLayout: () => <Outlet /> }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
  convertFileSrc: (path: string) => path,
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('../notes/NoteEditor', () => ({
  NoteEditor: () => <div role="textbox" aria-label="Meeting notes" />,
  NoteLoadingSkeleton: () => <p>Loading editor</p>,
}));
vi.mock('../meetings/ProcessingPanel', () => ({ ProcessingPanel: () => <p>Pipeline</p> }));

let db: Db;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Thursday 15 October 2026: the week runs Monday 12 to Sunday 18.
  vi.setSystemTime(new Date(2026, 9, 15, 12));
  resetState();
  await i18n.changeLanguage('en');
  db = freshDb();
  db.account = 'me@example.com';
  db.categories = [
    { name: 'Architect', preset: 7 },
    { name: 'Personal', preset: 11 },
  ];
  db.events = [
    event({
      id: 'e-arch',
      title: 'Architecture review',
      startsAt: at(1, 9),
      endsAt: at(1, 10, 30),
      categories: ['Architect'],
    }),
    event({
      id: 'e-lunch',
      title: 'Lunch',
      startsAt: at(0, 12),
      endsAt: at(0, 13),
      categories: ['Personal'],
    }),
    event({ id: 'e-sync', title: 'Team sync', startsAt: at(0, 15), endsAt: at(0, 16) }),
    event({
      id: 'e-holiday',
      title: 'Holiday',
      startsAt: '2026-10-12T00:00:00Z',
      endsAt: '2026-10-13T00:00:00Z',
      allDay: true,
    }),
    event({ id: 'e-sat', title: 'Weekend workshop', startsAt: at(2, 10), endsAt: at(2, 11) }),
    event({ id: 'e-next', title: 'Planning', startsAt: at(7, 10), endsAt: at(7, 11) }),
  ];
  vi.mocked(invoke).mockImplementation(backend(db));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const region = (name: string | RegExp) => screen.getByRole('region', { name });
const grid = () => document.querySelector<HTMLElement>('.ch-main')!;
const columns = () =>
  screen
    .getAllByRole('region')
    .map((r) => r.getAttribute('aria-label'))
    .filter((label) => /^\w+day, October \d+$/.test(label ?? ''));
const heading = (name: RegExp) => screen.findByRole('heading', { level: 2, name });

it('opens Reuniões on the week view with blocks in their day columns', async () => {
  renderAt('/meetings');
  await heading(/October 12.*18, 2026/);
  expect(screen.getByRole('button', { name: 'Week', pressed: true })).toBeInTheDocument();

  const arch = await within(region('Friday, October 16')).findByRole('button', {
    name: /Architecture review/,
  });
  expect(arch).toHaveAccessibleName('09:00 AM–10:30 AM, Architecture review, Category Architect');
  await waitFor(() => expect(arch).toHaveAttribute('data-category', 'blue'));
  expect(arch.style.getPropertyValue('--cx-cat-bg')).toBe('var(--outlook-cat-7-bg)');
  expect(arch.style.top).toBe(rem(9 * 48));
  expect(arch.style.height).toBe(rem(1.5 * 48 - 2));

  const today = region('Thursday, October 15');
  expect(today).toHaveAttribute('aria-current', 'date');
  expect(within(today).getByRole('button', { name: /Team sync/ })).toHaveAttribute(
    'data-tone',
    'event'
  );
  // All-day events sit in the strip above the hours, not in a column.
  expect(within(region('Monday, October 12')).queryByRole('button')).toBeNull();
  expect(within(grid()).getByRole('button', { name: /Holiday/ })).toBeInTheDocument();
  expect(within(grid()).queryByRole('button', { name: /Planning/ })).toBeNull();
});

it('maps the old week URL, moves between weeks and opens a meeting on double click', async () => {
  const router = renderAt('/meetings?tab=week');
  await heading(/October 12.*18, 2026/);
  expect(router.state.location.search).toMatchObject({ view: 'week' });
  expect(screen.getByRole('button', { name: 'Week', pressed: true })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
  await heading(/October 19.*25, 2026/);
  fireEvent.doubleClick(await within(grid()).findByRole('button', { name: /Planning/ }));
  await waitFor(() => expect(router.state.location.search).toMatchObject({ event: 'e-next' }));
  expect(await screen.findByRole('heading', { level: 2, name: 'Planning' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
  await heading(/October 19.*25, 2026/);
  fireEvent.click(screen.getByRole('button', { name: 'Today' }));
  await heading(/October 12.*18, 2026/);
});

it('picks 1–7 days from the day menu, steps by those days and remembers the view', async () => {
  const router = renderAt('/meetings');
  await heading(/October 12.*18, 2026/);
  const caret = screen.getByRole('button', { name: 'Number of days' });
  fireEvent.click(caret);
  const menu = screen.getByRole('menu', { name: 'Number of days' });
  const items = within(menu).getAllByRole('menuitemradio');
  expect(items.map((item) => item.textContent)).toEqual([
    '1 day',
    '2 days',
    '3 days',
    '4 days',
    '5 days',
    '6 days',
    '7 days',
  ]);
  await waitFor(() => expect(items[0]).toHaveFocus());
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(items[2]).toHaveFocus();
  fireEvent.click(items[2]);
  await waitFor(() => expect(router.state.location.search).toMatchObject({ view: 'day', days: 3 }));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(caret).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Day', pressed: true })).toBeInTheDocument();
  await heading(/October 15.*17, 2026/);
  expect(columns()).toEqual(['Thursday, October 15', 'Friday, October 16', 'Saturday, October 17']);

  fireEvent.click(screen.getByRole('button', { name: 'Next 3 days' }));
  await heading(/October 18.*20, 2026/);
  fireEvent.click(screen.getByRole('button', { name: 'Previous 3 days' }));
  await heading(/October 15.*17, 2026/);

  // A fresh visit without a view in the URL opens the last one chosen.
  cleanup();
  renderAt('/meetings');
  await heading(/October 15.*17, 2026/);
  expect(screen.getByRole('button', { name: 'Day', pressed: true })).toBeInTheDocument();
});

it('shows Monday to Friday in the work week and steps a week at a time', async () => {
  renderAt('/meetings');
  await heading(/October 12.*18, 2026/);
  fireEvent.click(screen.getByRole('button', { name: 'Work week' }));
  await heading(/October 12.*16, 2026/);
  expect(columns()).toEqual([
    'Monday, October 12',
    'Tuesday, October 13',
    'Wednesday, October 14',
    'Thursday, October 15',
    'Friday, October 16',
  ]);
  expect(within(grid()).queryByRole('button', { name: /Weekend workshop/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
  await heading(/October 19.*23, 2026/);
});

it('hides categories from the rail in every view', async () => {
  renderAt('/meetings?view=week');
  await screen.findByRole('button', { name: /Architecture review/ });
  const rail = screen.getByRole('complementary', { name: 'Calendar navigation and filters' });
  const filter = within(rail).getByRole('group', { name: 'Categories' });
  expect(
    within(filter)
      .getAllByRole('checkbox')
      .map((box) => box.closest('label')!.textContent)
  ).toEqual(['Architect', 'Personal', 'No category']);

  fireEvent.click(within(filter).getByRole('checkbox', { name: 'Architect' }));
  expect(within(grid()).queryByRole('button', { name: /Architecture review/ })).toBeNull();
  expect(within(grid()).getByRole('button', { name: /Lunch/ })).toBeInTheDocument();
  fireEvent.click(within(filter).getByRole('checkbox', { name: 'No category' }));
  expect(within(grid()).queryByRole('button', { name: /Team sync/ })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Month' }));
  const month = await within(grid()).findByRole('table');
  expect(within(month).queryByRole('button', { name: /Architecture review/ })).toBeNull();
  expect(within(month).getByRole('button', { name: /Lunch/ })).toBeInTheDocument();
});
