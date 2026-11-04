import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Outlet } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import {
  at,
  backend,
  calledWith,
  event,
  freshDb,
  renderAt,
  resetState,
  session,
  type Db,
} from './meetingsHub.harness';

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
  vi.setSystemTime(new Date(2026, 9, 15, 12));
  resetState();
  await i18n.changeLanguage('en');
  db = freshDb();
  db.account = 'me@example.com';
  db.categories = [
    { name: 'Architect', preset: 7 },
    { name: 'CTO', preset: 0 },
    { name: 'UX', preset: 5 },
    { name: 'Plain', preset: null },
  ];
  db.events = [
    event({ id: 'e-arch', title: 'Architecture review', categories: ['Architect', 'CTO'] }),
    event({
      id: 'e-cto',
      title: 'Board prep',
      startsAt: at(2, 9),
      endsAt: at(2, 10),
      categories: ['Plain', 'Unlisted', 'CTO'],
    }),
    event({ id: 'e-none', title: 'Lunch', startsAt: at(1, 12), endsAt: at(1, 13) }),
    event({
      id: 'e-linked',
      title: 'Weekly',
      startsAt: at(-1, 10),
      endsAt: at(-1, 11),
      categories: ['UX'],
    }),
  ];
  db.sessions = [session({ id: 'weekly', title: 'Weekly', starts_at: at(-1, 10) })];
  vi.mocked(invoke).mockImplementation(backend(db));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const row = (key: string) => document.querySelector<HTMLElement>(`[data-key="${key}"]`);
const deferred = () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  return { gate, release };
};

it('marks calendar blocks with their first coloured category and names it for screen readers', async () => {
  renderAt('/meetings');
  await waitFor(() => expect(row('e:e-arch')).toHaveAttribute('data-category', 'blue'));
  expect(row('e:e-arch')!.style.getPropertyValue('--cx-cat')).toBe('var(--outlook-cat-7)');
  expect(row('e:e-arch')!.style.getPropertyValue('--cx-cat-bg')).toBe('var(--outlook-cat-7-bg)');
  expect(row('e:e-arch')).toHaveAccessibleName(/Category Architect/);
  // Uncoloured and unknown categories are skipped for the first coloured one.
  expect(row('e:e-cto')).toHaveAttribute('data-category', 'red');
  expect(row('e:e-none')).not.toHaveAttribute('data-category');
  // A session linked to an event wears the event's colour.
  expect(row('s:weekly')).toHaveAttribute('data-category', 'teal');
  expect(row('s:weekly')).toHaveAccessibleName(/Category UX/);
});

it('tints month items with the category colour', async () => {
  renderAt('/meetings?view=month');
  const grid = await screen.findByRole('table');
  const item = await within(grid).findByRole('button', { name: /Architecture review/ });
  await waitFor(() =>
    expect(item.querySelector('[data-category]')).toHaveStyle({
      background: 'var(--outlook-cat-7)',
    })
  );
  expect(item).toHaveAttribute('data-category', 'blue');
  expect(item.style.getPropertyValue('--cx-cat-bg')).toBe('var(--outlook-cat-7-bg)');
  expect(item).toHaveAccessibleName(/Category Architect/);
  const lunch = within(grid).getByRole('button', { name: /Lunch/ });
  expect(lunch.querySelector('[data-category]')).toBeNull();
  expect(lunch).not.toHaveAttribute('data-category');
});

const chips = (inspector: HTMLElement) =>
  within(inspector)
    .queryAllByRole('listitem')
    .map((li) => li.textContent);
const backToCalendar = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
  await screen.findByRole('complementary', { name: 'Calendar navigation and filters' });
};

it('changes categories optimistically and sends them to Outlook', async () => {
  const { gate, release } = deferred();
  db.setCategories.gate = gate;
  renderAt('/meetings?event=e-none');
  const inspector = await screen.findByRole('complementary', { name: 'Meeting details' });
  expect(within(inspector).getByText('No category.')).toBeInTheDocument();
  fireEvent.click(within(inspector).getByRole('button', { name: 'Change' }));
  const picker = within(inspector).getByRole('group', { name: 'Outlook categories' });
  const ux = within(picker).getByRole('button', { name: 'UX' });
  expect(ux).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(ux);
  // Before the backend answers.
  expect(chips(inspector)).toContain('UX');
  expect(ux).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() =>
    expect(calledWith(db, 'calendar_set_categories')).toEqual([
      { eventId: 'e-none', categories: ['UX'] },
    ])
  );
  await act(async () => release());
  await backToCalendar();
  await waitFor(() => expect(row('e:e-none')).toHaveAttribute('data-category', 'teal'));
});

it('removing the only category clears the colour in the calendar', async () => {
  db.events = db.events.map((e) => (e.id === 'e-none' ? { ...e, categories: ['UX'] } : e));
  renderAt('/meetings?event=e-none');
  const inspector = await screen.findByRole('complementary', { name: 'Meeting details' });
  fireEvent.click(await within(inspector).findByRole('button', { name: 'Change' }));
  fireEvent.click(within(inspector).getByRole('button', { name: 'UX' }));
  await waitFor(() =>
    expect(calledWith(db, 'calendar_set_categories').at(-1)).toEqual({
      eventId: 'e-none',
      categories: [],
    })
  );
  await backToCalendar();
  await waitFor(() => expect(row('e:e-none')).toBeInTheDocument());
  expect(row('e:e-none')).not.toHaveAttribute('data-category');
});

it('rolls back and explains when Outlook refuses the change', async () => {
  const { gate, release } = deferred();
  db.setCategories = { gate, error: 'calendar.categoriesReconnect' };
  renderAt('/meetings?event=e-arch');
  const inspector = await screen.findByRole('complementary', { name: 'Meeting details' });
  fireEvent.click(within(inspector).getByRole('button', { name: 'Change' }));
  fireEvent.click(within(inspector).getByRole('button', { name: 'Architect' }));
  // Architect removed before Outlook answers.
  expect(within(inspector).getByRole('button', { name: 'Architect' })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await act(async () => release());
  expect(await within(inspector).findByRole('alert')).toHaveTextContent(
    'Outlook did not allow changing categories. Reconnect Outlook to grant it.'
  );
  expect(within(inspector).getByRole('button', { name: 'Architect' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await backToCalendar();
  await waitFor(() => expect(row('e:e-arch')).toHaveAttribute('data-category', 'blue'));
});

it('asks to reconnect when the categories scope is missing, without colours', async () => {
  // A connection needs a client id; a checkout without `.env.local` has none.
  localStorage.setItem('outlook.clientId', 'fixture-client');
  db.categoryAccess = { read: false, write: false };
  db.categories = [];
  renderAt('/meetings?event=e-arch');
  const inspector = await screen.findByRole('complementary', { name: 'Meeting details' });
  expect(
    await within(inspector).findByText('Reconnect Outlook to use categories and their colours.')
  ).toBeInTheDocument();
  expect(within(inspector).queryByRole('button', { name: 'Change' })).toBeNull();
  fireEvent.click(within(inspector).getByRole('button', { name: 'Reconnect Outlook' }));
  const sheet = await screen.findByRole('dialog');
  expect(
    within(sheet).getByText(/Categories need a new permission/, { exact: false })
  ).toBeInTheDocument();
  expect(within(sheet).getByRole('button', { name: 'Reconnect Outlook' })).toBeEnabled();
  fireEvent.keyDown(sheet, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await backToCalendar();
  await waitFor(() => expect(row('e:e-arch')).toBeInTheDocument());
  expect(row('e:e-arch')).not.toHaveAttribute('data-category');
});

it('shows categories read-only when only reading was granted', async () => {
  db.categoryAccess = { read: true, write: false };
  renderAt('/meetings?event=e-arch');
  const inspector = await screen.findByRole('complementary', { name: 'Meeting details' });
  const chips = await within(inspector).findByRole('list', { name: 'Event categories' });
  expect(
    within(chips)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
  ).toEqual(['Architect', 'CTO']);
  expect(within(inspector).queryByRole('button', { name: 'Change' })).toBeNull();
  expect(
    within(inspector).getByText('Reconnect Outlook to change categories here.')
  ).toBeInTheDocument();
});
