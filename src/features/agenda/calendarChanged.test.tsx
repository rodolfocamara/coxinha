import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useCalendarSnapshot } from '../hoje/useHojeData';
import { useOutlookConnection } from './useOutlookConnection';
import { emptyCalendar, type CalendarSnapshot } from './calendar';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
const handlers = vi.hoisted(() => new Set<() => void>());
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (event: string, handler: () => void) => {
    if (event === 'calendar-changed') handlers.add(handler);
    return () => handlers.delete(handler);
  },
}));

const connected: CalendarSnapshot = {
  account: 'sub-1',
  syncedAt: '2026-11-02T14:28:55Z',
  events: [
    {
      id: 'e1',
      title: 'Comitê de TI',
      startsAt: '2026-11-03T13:00:00Z',
      endsAt: '2026-11-03T14:00:00Z',
      cancelled: false,
      allDay: false,
      attendees: [],
    },
  ],
};
let cache: CalendarSnapshot;

beforeEach(() => {
  handlers.clear();
  cache = emptyCalendar;
  vi.mocked(invoke).mockImplementation(async (cmd) =>
    cmd === 'calendar_status' ? cache : undefined
  );
});

it('re-reads the cached agenda in open views when the backend reports a change', async () => {
  const home = renderHook(() => useCalendarSnapshot());
  const hub = renderHook(() => useOutlookConnection());
  await waitFor(() =>
    expect(home.result.current[0]).toEqual({ kind: 'ready', data: emptyCalendar })
  );
  await waitFor(() => expect(handlers.size).toBe(2));
  // Connected from Settings: the backend saved the first sync.
  cache = connected;
  act(() => handlers.forEach((notify) => notify()));
  await waitFor(() => expect(home.result.current[0]).toEqual({ kind: 'ready', data: connected }));
  await waitFor(() => expect(hub.result.current.snapshot).toEqual(connected));
  expect(hub.result.current.connected).toBe(true);
  home.unmount();
  hub.unmount();
  await waitFor(() => expect(handlers.size).toBe(0));
});
