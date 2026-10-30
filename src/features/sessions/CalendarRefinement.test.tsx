import { changeControl } from '../../test/changeControl';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Outlet, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { createAppRouter } from '../../router';
import { useSidebar } from '../../lib/sidebar';
import { sessionListCache } from './sessions';
import { useSessionNavigation } from './sessionNavigation';
import { calendarSession } from './calendarFixtures';
import { dayKey, localDay } from './sessionDates';
vi.mock('../../routes/__root', () => ({ RootLayout: () => <Outlet /> }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
  convertFileSrc: (p: string) => p,
}));
vi.mock('../../components/AppShell/WindowChrome', () => ({
  WindowChromeProvider: ({ children }: { children: React.ReactNode }) => children,
  WindowChrome: ({ children }: { children: React.ReactNode }) => children,
  WindowDragRegion: () => null,
}));
vi.mock('../../components/AppShell/WindowFrame', () => ({
  WindowFrame: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../../components/AppShell/RecordingStatus', () => ({ RecordingStatus: () => null }));
vi.mock('../board/ActivityBoard', () => ({ ActivityBoard: () => <p>Existing activity map</p> }));
const rows = [
  calendarSession('september', {
    starts_at: '2026-09-10T15:00:00Z',
    transcript_status: 'available',
  }),
  calendarSession('october', {
    starts_at: '2026-10-24T15:00:00Z',
    transcript_status: 'none',
    processing_state: 'weird_future_state',
  }),
];
beforeEach(async () => {
  await i18n.changeLanguage('en');
  useSidebar.getState().setOpen(true);
  useSessionNavigation.setState({
    sidebarPeriod: { kind: 'all' },
    calendarPeriod: { kind: 'all' },
    month: localDay(2026, 9, 1),
    transcript: 'all',
    selectedDay: null,
    view: 'month',
  });
  sessionListCache.setState({ data: rows, isError: false, updatedAt: Date.now() });
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === 'library_sessions' ? rows : { active: null, error: null }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(client);
  router.history.push('/calendar');
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  await screen.findByRole('heading', { name: i18n.t('sessionCalendar.title') });
  return router;
}
const main = () => within(screen.getByRole('main'));
function custom(start: string, end: string) {
  changeControl(main().getByRole('combobox', { name: i18n.t('sessionCalendar.calendarPeriod') }), {
    target: { value: 'custom' },
  });
  changeControl(main().getByLabelText(i18n.t('sessionCalendar.from')), {
    target: { value: start },
  });
  changeControl(main().getByLabelText(i18n.t('sessionCalendar.through')), {
    target: { value: end },
  });
  fireEvent.click(main().getByRole('button', { name: i18n.t('sessionCalendar.apply') }));
}
it('F2 preserves a multi-month custom period on previous, next and Today, without a phantom option', async () => {
  await mount();
  custom('2026-09-01', '2026-11-30');
  expect(main().getByRole('heading', { name: 'September 2026' })).toBeVisible();
  const period = { ...useSessionNavigation.getState().calendarPeriod };
  fireEvent.click(main().getByRole('button', { name: 'Next month' }));
  expect(main().getByRole('heading', { name: 'October 2026' })).toBeVisible();
  fireEvent.click(main().getByRole('button', { name: 'Previous month' }));
  expect(main().getByRole('heading', { name: 'September 2026' })).toBeVisible();
  fireEvent.click(main().getByRole('button', { name: 'Today' }));
  expect(useSessionNavigation.getState().calendarPeriod).toEqual(period);
  expect(useSessionNavigation.getState().selectedDay).toBe(dayKey(new Date()));
  expect(main().queryByRole('option', { name: 'Displayed month' })).toBeNull();
  expect(main().getByRole('combobox', { name: 'Calendar period' })).toHaveValue('custom');
});
it('F3 aligns applied ranges, explains empty months and returns to the range without changing it', async () => {
  await mount();
  custom('2026-09-01', '2026-09-30');
  const period = { ...useSessionNavigation.getState().calendarPeriod };
  fireEvent.click(main().getByRole('button', { name: 'Next month' }));
  const status = within(main().getByRole('status'));
  expect(status.getByText(/1 match is outside the displayed month/)).toBeVisible();
  fireEvent.click(status.getByRole('button', { name: 'Go to period' }));
  expect(main().getByRole('heading', { name: 'September 2026' })).toBeVisible();
  expect(useSessionNavigation.getState().calendarPeriod).toEqual(period);
  expect(main().queryByRole('status')).toBeNull();
});
it('F3 aligns Today and All presets to the local current month', async () => {
  await mount();
  custom('2000-01-01', '2000-01-03');
  changeControl(main().getByRole('combobox', { name: 'Calendar period' }), {
    target: { value: 'today' },
  });
  expect(useSessionNavigation.getState().month.getMonth()).toBe(new Date().getMonth());
  expect(useSessionNavigation.getState().month.getFullYear()).toBe(new Date().getFullYear());
  fireEvent.click(main().getByRole('button', { name: 'Previous month' }));
  expect(useSessionNavigation.getState().calendarPeriod.kind).toBe('today');
  changeControl(main().getByRole('combobox', { name: 'Calendar period' }), {
    target: { value: 'all' },
  });
  expect(dayKey(useSessionNavigation.getState().month)).toBe(
    dayKey(localDay(new Date().getFullYear(), new Date().getMonth(), 1))
  );
});
it('F2 Today outside a custom interval preserves it and reports an honest empty selected day', async () => {
  await mount();
  custom('2000-01-01', '2000-01-03');
  fireEvent.click(main().getByRole('button', { name: 'Today' }));
  expect(useSessionNavigation.getState().calendarPeriod).toEqual({
    kind: 'custom',
    start: '2000-01-01',
    end: '2000-01-03',
  });
  const detail = within(main().getByRole('region', { name: 'Selected day meetings' }));
  expect(detail.getByText('No meetings on this day match the applied filters.')).toBeVisible();
  expect(detail.getByText(/Applied: Custom dates/)).toHaveTextContent('1/1/2000');
});
it('F2 list results remain on All when month navigation and Today move the view', async () => {
  await mount();
  fireEvent.click(main().getByRole('button', { name: 'Agenda list' }));
  const list = () => within(main().getByRole('region', { name: 'Agenda list' }));
  expect(list().getAllByRole('button')).toHaveLength(2);
  fireEvent.click(main().getByRole('button', { name: 'Next month' }));
  fireEvent.click(main().getByRole('button', { name: 'Today' }));
  expect(list().getAllByRole('button')).toHaveLength(2);
  expect(main().getByText('All dated meetings in the applied period.')).toBeVisible();
  expect(useSessionNavigation.getState().calendarPeriod.kind).toBe('all');
});
it('F4/F6 has two compact sidebar lines, short time, accessible statuses, short date and localized unknown processing', async () => {
  await mount();
  const sidebar = within(screen.getByRole('navigation', { name: 'Main navigation' }));
  const item = sidebar.getByRole('button', { name: /Meeting october/ });
  expect(item.children).toHaveLength(2);
  expect(item.querySelector('time')?.textContent).not.toMatch(/:\d{2}:\d{2}/);
  expect(item).toHaveAccessibleName(/No audio.*No saved transcript.*Processing status unknown/);
  expect(item.textContent).not.toContain('library.processing.state.weird_future_state');
  const heading = sidebar.getByRole('heading', { name: 'Saturday, October 24, 2026' });
  expect(heading.textContent).not.toContain('Saturday, October');
  const help = main().getByText('Help and filter rules');
  expect(help.tagName).toBe('SUMMARY');
  expect(help.parentElement).not.toHaveAttribute('open');
  fireEvent.click(main().getByRole('button', { name: 'Agenda list' }));
  expect(main().getByText('Processing status unknown')).toBeVisible();
});
it('F4/F5 provides a native table bypass and focuses selected-day results in a narrow container', async () => {
  await mount();
  expect(main().getByRole('link', { name: 'Skip calendar to day details' })).toHaveAttribute(
    'href',
    '#calendar-day-detail'
  );
  const day = main().getByRole('button', { name: /^Saturday, October 24, 2026\./ });
  day.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() =>
    expect(main().getByRole('region', { name: 'Selected day meetings' })).toHaveFocus()
  );
  expect(main().getByRole('table')).not.toHaveAttribute('role', 'grid');
});
it('F4 keeps focus in the month when the content container is wide enough for side details', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 1000,
  } as DOMRect);
  await mount();
  const day = main().getByRole('button', { name: /^Saturday, October 24, 2026\./ });
  day.focus();
  fireEvent.click(day);
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  expect(day).toHaveFocus();
});
it('F7 localizes applied date ranges in Portuguese and retains unrelated locale namespaces', async () => {
  await i18n.changeLanguage('pt-BR');
  await mount();
  custom('2026-09-01', '2026-11-30');
  const summary = main().getByRole('button', { name: /Aplicado: Datas personalizadas/ });
  expect(summary).toHaveTextContent('01/09/2026');
  expect(summary).toHaveTextContent('30/11/2026');
  expect(summary).not.toHaveTextContent('2026-09-01');
});
