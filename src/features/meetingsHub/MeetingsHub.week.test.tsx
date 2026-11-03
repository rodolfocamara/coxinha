import { rem } from '../../lib/appearance/units';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { Outlet } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import {
  at,
  backend,
  event,
  freshDb,
  recording,
  renderAt,
  resetState,
  session,
  type Db,
} from './meetingsHub.harness';
import { resetTimeZones } from './timeZones';

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
  vi.setSystemTime(new Date(2026, 9, 15, 18));
  resetState();
  await i18n.changeLanguage('en');
  db = freshDb();
  db.account = 'me@example.com';
  db.events = [
    event({ id: 'e-sync', title: 'Team sync', startsAt: at(0, 15), endsAt: at(0, 16) }),
    event({ id: 'e-lunch', title: 'Lunch', startsAt: at(0, 12), endsAt: at(0, 13) }),
  ];
  vi.mocked(invoke).mockImplementation(backend(db));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const day = (name: string) => screen.getByRole('region', { name });
const heading = (name: RegExp) => screen.findByRole('heading', { level: 2, name });

it('shows every recording at its real span beside Outlook events, each meeting once', async () => {
  db.sessions = [
    // Recorded outside the calendar: no event has its title or time.
    session({
      id: 's-numbers',
      title: 'Quarterly numbers',
      starts_at: at(0, 9, 10),
      ends_at: at(0, 9, 52),
      meeting_id: 'm-numbers',
      recording: recording('m-numbers', 'Quarterly numbers', 'finished', at(0, 9, 10)),
    }),
    // Recorded into its Outlook event: one block, not two.
    session({
      id: 's-sync',
      title: 'Team sync',
      starts_at: at(0, 15),
      ends_at: at(0, 16),
      meeting_id: 'm-sync',
      recording: recording('m-sync', 'Team sync', 'finished', at(0, 15, 2)),
    }),
    // Earlier in the week, past days included.
    session({
      id: 's-swap',
      title: 'Shift swaps',
      starts_at: at(-3, 10, 20),
      ends_at: at(-3, 12, 6),
      meeting_id: 'm-swap',
      recording: recording('m-swap', 'Shift swaps', 'finished', at(-3, 10, 20)),
    }),
  ];
  renderAt('/meetings?view=week');
  await heading(/October 12.*18, 2026/);

  const thursday = day('Thursday, October 15');
  const numbers = await within(thursday).findByRole('button', { name: /Quarterly numbers/ });
  expect(numbers).toHaveAccessibleName('09:10 AM–09:52 AM, Quarterly numbers');
  expect(numbers).toHaveAttribute('data-tone', 'recorded');
  expect(numbers.style.top).toBe(rem((9 + 10 / 60) * 48));
  expect(numbers.style.height).toBe(rem((42 / 60) * 48 - 2));

  const sync = within(thursday).getAllByRole('button', { name: /Team sync/ });
  expect(sync).toHaveLength(1);
  expect(sync[0]).toHaveAttribute('data-key', 's:s-sync');
  expect(sync[0]).toHaveAttribute('data-tone', 'event');
  expect(within(thursday).getByRole('button', { name: /Lunch/ })).toHaveAttribute(
    'data-key',
    'e:e-lunch'
  );
  expect(
    within(day('Monday, October 12')).getByRole('button', { name: /Shift swaps/ })
  ).toHaveAccessibleName('10:20 AM–12:06 PM, Shift swaps');
});

const gutter = () => document.querySelector<HTMLElement>('.mh-week-hours')!;
const column = (zone: string) =>
  [...gutter().querySelectorAll(`[data-zone="${zone}"] span`)].map((s) => s.textContent);

it('puts each hour label under its line, with the extra zones from Settings beside it', async () => {
  renderAt('/meetings?view=week');
  await heading(/October 12.*18, 2026/);
  // Without extra zones: one column of local clock times, midnight included.
  expect(gutter()).not.toHaveAttribute('data-zones');
  expect(column('local')).toHaveLength(24);
  expect(column('local')[9]).toBe('09:00 AM');
  expect(document.querySelector('.mh-week-zones')).toBeNull();
  cleanup();

  window.localStorage.setItem(
    'coxinha:calendar-time-zones',
    JSON.stringify([
      { id: 'Etc/GMT-2', label: 'IL' },
      { id: 'Etc/GMT+6', label: '' },
    ])
  );
  window.localStorage.setItem('coxinha:calendar-local-zone-label', 'BR');
  resetTimeZones();
  renderAt('/meetings?view=week');
  await heading(/October 12.*18, 2026/);
  expect(gutter()).toHaveAttribute('data-zones', '2');
  const labels = [...document.querySelectorAll('.mh-week-zones span')].map((s) => s.textContent);
  expect(labels).toEqual(['IL', 'GMT-6', 'BR']);
  const utc = (hour: number) => new Date(2026, 9, 12, hour).getUTCHours();
  const two = (hour: number) => String(hour).padStart(2, '0');
  expect(column('Etc/GMT-2')[9]).toBe(two((utc(9) + 2) % 24));
  expect(column('Etc/GMT+6')[9]).toBe(two((utc(9) + 18) % 24));
  expect(column('local')[9]).toBe('09');
  const grid = document.querySelector<HTMLElement>('.mh-week-grid')!;
  expect(grid.style.getPropertyValue('--mh-week-gutter')).toBe(rem(102));
});

it('leads from the agenda to the time zone setting (spec 0123)', async () => {
  const router = renderAt('/meetings?view=week');
  await heading(/October 12.*18, 2026/);
  screen.getByRole('button', { name: 'Time zones' }).click();
  await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
  expect(router.state.location.hash).toBe('calendar');
});
