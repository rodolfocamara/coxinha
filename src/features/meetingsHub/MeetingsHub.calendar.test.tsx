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
  db.categories = [{ name: 'Architect', preset: 7 }];
  db.events = [
    event({
      id: 'e-arch',
      title: 'Architecture review',
      startsAt: at(1, 9),
      endsAt: at(1, 10, 30),
      categories: ['Architect'],
    }),
    event({ id: 'e-lunch', title: 'Lunch', startsAt: at(0, 12), endsAt: at(0, 13) }),
    event({
      id: 'e-holiday',
      title: 'Holiday',
      startsAt: '2026-10-12T00:00:00Z',
      endsAt: '2026-10-13T00:00:00Z',
      allDay: true,
    }),
    event({ id: 'e-next', title: 'Planning', startsAt: at(7, 10), endsAt: at(7, 11) }),
  ];
  vi.mocked(invoke).mockImplementation(backend(db));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const week = (name: RegExp) => screen.getByRole('region', { name });
const column = (name: RegExp) => screen.getByRole('region', { name });

it('opens the week from its tab with blocks in their day columns', async () => {
  const router = renderAt('/meetings');
  fireEvent.click(await screen.findByRole('tab', { name: 'Week' }));
  await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: 'week' }));
  expect(await screen.findByRole('heading', { level: 2, name: /October 12.*18, 2026/ }));

  const friday = await waitFor(() => column(/Friday, October 16/));
  const arch = await within(friday).findByRole('button', { name: /Architecture review/ });
  expect(arch).toHaveAccessibleName('09:00 AM–10:30 AM, Architecture review, Category Architect');
  await waitFor(() => expect(arch).toHaveAttribute('data-category', 'blue'));
  expect(arch.style.getPropertyValue('--cx-cat-bg')).toBe('var(--outlook-cat-7-bg)');
  expect(arch.style.top).toBe(`${9 * 48}px`);
  expect(arch.style.height).toBe(`${1.5 * 48 - 2}px`);

  const today = column(/Thursday, October 15/);
  expect(today).toHaveAttribute('aria-current', 'date');
  const lunch = within(today).getByRole('button', { name: /Lunch/ });
  expect(lunch).not.toHaveAttribute('data-category');
  expect(lunch).toHaveAttribute('data-tone', 'event');

  // All-day events sit in the strip above the hours, not in a column.
  expect(within(column(/Monday, October 12/)).queryByRole('button')).toBeNull();
  expect(
    within(week(/October 12.*18, 2026/)).getByRole('button', { name: /Holiday/ })
  ).toBeInTheDocument();
  expect(
    within(week(/October 12.*18, 2026/)).queryByRole('button', { name: /Planning/ })
  ).toBeNull();
});

it('moves between weeks and opens a meeting in the list view', async () => {
  const router = renderAt('/meetings?tab=week');
  await screen.findByRole('heading', { level: 2, name: /October 12.*18, 2026/ });
  fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
  expect(await screen.findByRole('heading', { level: 2, name: /October 19.*25, 2026/ }));
  fireEvent.click(
    await within(week(/October 19.*25, 2026/)).findByRole('button', { name: /Planning/ })
  );
  await waitFor(() => expect(router.state.location.search).toMatchObject({ event: 'e-next' }));
  expect(router.state.location.search).not.toHaveProperty('tab');
  expect(
    screen.getByRole('tab', { name: 'Upcoming and recent', selected: true })
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Week' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Today' }));
  expect(await screen.findByRole('heading', { level: 2, name: /October 12.*18, 2026/ }));
});
