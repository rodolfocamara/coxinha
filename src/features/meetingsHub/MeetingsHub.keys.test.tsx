import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { Outlet } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { CALENDAR_PREF_KEYS } from './calendarViews';
import { useCalendarHome } from './calendarHomeModel';
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
  NoteEditor: () => null,
  NoteLoadingSkeleton: () => null,
}));

let db: Db;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 15, 12));
  resetState();
  await i18n.changeLanguage('en');
  for (const key of CALENDAR_PREF_KEYS) localStorage.removeItem(key);
  useCalendarHome.setState({ anchor: null });
  db = freshDb();
  db.account = 'me@example.com';
  db.events = [event({ id: 'e-plan', title: 'Planning', startsAt: at(0, 14), endsAt: at(0, 15) })];
  vi.mocked(invoke).mockImplementation(backend(db) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const press = (key: string, target: Element = document.body) =>
  act(async () => {
    fireEvent.keyDown(target, { key });
  });
const title = () => document.querySelector('.ch-title')!.textContent!;
const pressed = (name: string) => screen.getByRole('button', { name, pressed: true });

async function calendar(route = '/meetings?view=week') {
  const view = renderAt(route);
  await waitFor(() => expect(document.querySelector('.ch-title')).not.toBeNull());
  return view;
}

it.each([
  ['J', 'j', 'k'],
  ['the right arrow', 'ArrowRight', 'ArrowLeft'],
])('%s moves forward, and its pair comes back', async (_name, forward, back) => {
  await calendar();
  const start = title();
  await press(forward);
  expect(title()).not.toBe(start);
  await press(back);
  expect(title()).toBe(start);
});

it('K and the left arrow move back', async () => {
  await calendar();
  const start = title();
  await press('k');
  const first = title();
  expect(first).not.toBe(start);
  await press('ArrowLeft');
  expect(title()).not.toBe(first);
});

it('T comes back to today', async () => {
  await calendar();
  const start = title();
  await press('j');
  await press('j');
  expect(title()).not.toBe(start);
  await press('t');
  expect(title()).toBe(start);
});

it('D, W and M change the view', async () => {
  await calendar();
  expect(pressed('Week')).toBeInTheDocument();
  await press('m');
  await waitFor(() => expect(pressed('Month')).toBeInTheDocument());
  await press('d');
  await waitFor(() => expect(pressed('Day')).toBeInTheDocument());
  await press('w');
  await waitFor(() => expect(pressed('Week')).toBeInTheDocument());
});

it('N opens the new meeting sheet, and the sheet blocks the rest until Esc', async () => {
  await calendar();
  await press('n');
  const sheet = await screen.findByRole('dialog');
  const start = title();
  await press('j', sheet);
  expect(title()).toBe(start);
  fireEvent.keyDown(sheet, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await press('j');
  expect(title()).not.toBe(start);
});

it('Enter opens the focused meeting, and the keys stay on the calendar', async () => {
  const view = await calendar();
  const block = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('.mh-week-ev[aria-label*="Planning"]');
    expect(found).not.toBeNull();
    return found!;
  });
  block.focus();
  await press('Enter', block);
  await waitFor(() => expect(view.state.location.search).toMatchObject({ event: 'e-plan' }));
  await waitFor(() => expect(document.querySelector('.ch-title')).toBeNull());
  const route = view.state.location.href;
  await press('m');
  await press('j');
  expect(view.state.location.href).toBe(route);
});

it('a focused search field keeps the letters', async () => {
  await calendar();
  const start = title();
  const field = document.createElement('input');
  document.body.append(field);
  await press('j', field);
  await press('t', field);
  await press('m', field);
  expect(title()).toBe(start);
  expect(pressed('Week')).toBeInTheDocument();
  field.remove();
});
