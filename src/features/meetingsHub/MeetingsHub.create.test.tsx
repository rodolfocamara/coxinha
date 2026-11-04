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
  // Thursday 15 October 2026, noon.
  vi.setSystemTime(new Date(2026, 9, 15, 12));
  resetState();
  await i18n.changeLanguage('en');
  db = freshDb();
  db.account = 'me@example.com';
  db.events = [event({ id: 'e-lunch', title: 'Lunch', startsAt: at(0, 12), endsAt: at(0, 13) })];
  vi.mocked(invoke).mockImplementation(backend(db));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const HOUR = 48;
const thursday = () => screen.getByRole('region', { name: 'Thursday, October 15' });
const press = (column: HTMLElement, hours: number) =>
  fireEvent.pointerDown(column, { button: 0, pointerId: 1, clientY: hours * HOUR });
const move = (column: HTMLElement, hours: number) =>
  fireEvent.pointerMove(column, { pointerId: 1, clientY: hours * HOUR });
const release = (column: HTMLElement, hours: number) =>
  fireEvent.pointerUp(column, { pointerId: 1, clientY: hours * HOUR });
const field = (name: string) => screen.getByLabelText<HTMLInputElement>(name);
const outlookBox = () => screen.getByRole('checkbox', { name: 'Also create in Outlook' });

async function openWeek() {
  const router = renderAt('/meetings?view=week');
  await waitFor(() => within(thursday()).getByRole('button', { name: /Lunch/ }));
  return router;
}

it('turns a click on an empty slot into a half-hour meeting proposal', async () => {
  await openWeek();
  const column = thursday();
  press(column, 9 + 40 / 60);
  release(column, 9 + 40 / 60);
  expect(await screen.findByRole('dialog', { name: 'New meeting' })).toBeInTheDocument();
  expect(field('Date').value).toBe('2026-10-15');
  expect(field('Start').value).toBe('09:30');
  expect(field('End').value).toBe('10:00');
  expect(outlookBox()).toBeEnabled();
  expect(outlookBox()).not.toBeChecked();
  expect(calledWith(db, 'library_create_session')).toEqual([]);
});

it('previews a dragged range and proposes it snapped to 15 minutes', async () => {
  await openWeek();
  const column = thursday();
  press(column, 14 + 5 / 60);
  move(column, 15 + 20 / 60);
  expect(within(column).getByText('02:00 PM–03:30 PM')).toBeInTheDocument();
  release(column, 15 + 20 / 60);
  await screen.findByRole('dialog', { name: 'New meeting' });
  expect(field('Start').value).toBe('14:00');
  expect(field('End').value).toBe('15:30');
});

it('cancels a drag with Escape and leaves presses on a block to the block', async () => {
  const router = await openWeek();
  const column = thursday();
  press(column, 9);
  move(column, 10);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(within(column).queryByText(/AM–/)).toBeNull();
  release(column, 10);
  expect(screen.queryByRole('dialog', { name: 'New meeting' })).toBeNull();

  const lunch = within(column).getByRole('button', { name: /Lunch/ });
  fireEvent.pointerDown(lunch, { button: 0, pointerId: 2, clientY: 12 * HOUR });
  fireEvent.pointerUp(lunch, { pointerId: 2, clientY: 12 * HOUR });
  fireEvent.click(lunch);
  // A press on a block selects it (spec 0107 peek); no new meeting is proposed.
  expect(await screen.findByRole('complementary', { name: 'Lunch' })).toBeInTheDocument();
  expect(router.state.location.search).not.toHaveProperty('event');
  expect(screen.queryByRole('dialog', { name: 'New meeting' })).toBeNull();
});

it('disables the Outlook option without write access and offers to reconnect', async () => {
  db.categoryAccess = { read: true, write: false };
  await openWeek();
  press(thursday(), 9);
  release(thursday(), 9);
  await screen.findByRole('dialog', { name: 'New meeting' });
  expect(outlookBox()).toBeDisabled();
  expect(screen.getByText('Reconnect Outlook to create events from here.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect Outlook' }));
  expect(await screen.findByRole('dialog', { name: 'Outlook' })).toBeInTheDocument();
});

it('creates the meeting, then the Outlook event for the same slot', async () => {
  const router = await openWeek();
  press(thursday(), 9);
  release(thursday(), 9);
  await screen.findByRole('dialog', { name: 'New meeting' });
  fireEvent.change(field('Title'), { target: { value: 'Project Atlas' } });
  fireEvent.click(outlookBox());
  fireEvent.click(screen.getByRole('button', { name: 'Create meeting' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/meetings/s-new-0'));
  const [created] = calledWith(db, 'library_create_session');
  expect(created.input).toMatchObject({
    title: 'Project Atlas',
    starts_at: at(0, 9),
    ends_at: at(0, 9, 30),
  });
  expect(calledWith(db, 'calendar_create_event')).toEqual([
    { subject: 'Project Atlas', startsAt: at(0, 9), endsAt: at(0, 9, 30), transactionId: 's-new-0' },
  ]);
});

it('keeps the meeting when Outlook fails and retries only the event', async () => {
  db.createEvent.error = 'calendar.failed';
  const router = await openWeek();
  press(thursday(), 9);
  release(thursday(), 9);
  await screen.findByRole('dialog', { name: 'New meeting' });
  fireEvent.change(field('Title'), { target: { value: 'Project Atlas' } });
  fireEvent.click(outlookBox());
  fireEvent.click(screen.getByRole('button', { name: 'Create meeting' }));
  expect(
    await screen.findByText('The meeting was created in Coxinha, but not in Outlook.')
  ).toBeInTheDocument();
  expect(field('Title')).toBeDisabled();
  expect(router.state.location.pathname).toBe('/meetings');

  db.createEvent.error = null;
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Try Outlook again' }));
  });
  await waitFor(() => expect(router.state.location.pathname).toBe('/meetings/s-new-0'));
  expect(calledWith(db, 'library_create_session')).toHaveLength(1);
  const attempts = calledWith(db, 'calendar_create_event');
  expect(attempts.map((a) => a.transactionId)).toEqual(['s-new-0', 's-new-0']);
});
