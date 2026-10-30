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
import { sessionListCache, type Session } from './sessions';
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
vi.mock('../notes/NoteEditor', () => ({
  NoteEditor: () => <p>Existing session editor</p>,
  NoteLoadingSkeleton: () => null,
}));
let rows: Session[];
const scheduled = (id: string, day: number, transcript_status?: Session['transcript_status']) =>
  calendarSession(id, { starts_at: new Date(2026, 9, day, 12).toISOString(), transcript_status });
beforeEach(async () => {
  await i18n.changeLanguage('en');
  useSidebar.getState().setOpen(true);
  useSessionNavigation.setState({
    sidebarPeriod: { kind: 'all' },
    calendarPeriod: { kind: 'all' },
    transcript: 'all',
    month: localDay(2026, 9, 1),
    selectedDay: null,
    view: 'month',
  });
  rows = [
    scheduled('saved', 24, 'available'),
    scheduled('none', 24, 'none'),
    scheduled('empty', 24, 'empty'),
    scheduled('unknown', 24),
    scheduled('unavailable', 24, 'unavailable'),
    scheduled('next', 30, 'none'),
    calendarSession('manual', { transcript_status: 'none' }),
    calendarSession('recorded', {
      recording: {
        id: 'r',
        title: 'r',
        createdAt: '2026-10-23 14:00:00',
        captureState: 'finished',
      },
    }),
  ];
  rows[0].processing_state = 'failed';
  sessionListCache.setState({ data: rows, isError: false, updatedAt: Date.now() });
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const a = args as Record<string, string>;
    if (command === 'library_sessions') return rows;
    if (command === 'library_session') return rows.find((s) => s.id === a.sessionId);
    if (command === 'library_status') return { active: null, error: null };
    if (command === 'library_ensure_personal_note') return { personal_note: { id: 'n1' } };
    if (command === 'get_note')
      return { note: { id: 'n1', title: 'Note', tags: [] }, markdown: '' };
    if (command === 'library_detail')
      return { meeting: rows[7].recording, audio: null, manifest: null, inference: 'unavailable' };
    throw new Error(`Unexpected command ${command}`);
  });
});
afterEach(cleanup);
function mount(path = '/calendar') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(client);
  router.history.push(path);
  const rendered = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return { router, ...rendered };
}
const main = () => within(screen.getByRole('main'));
const sidebar = () =>
  within(screen.getByRole('navigation', { name: i18n.t('a11y.mainNavigation') }));
const day = () => screen.getByRole('button', { name: /^Saturday, October 24, 2026\./ });

it('exposes explicit map/calendar destinations with correct active state and contextual Outlook utility', async () => {
  const { router } = mount('/');
  await screen.findByText('Existing activity map');
  expect(sidebar().getByRole('link', { name: 'Activities' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  expect(sidebar().getByRole('link', { name: 'Calendar' })).not.toHaveAttribute('aria-current');
  fireEvent.click(sidebar().getByRole('link', { name: 'Calendar' }));
  await screen.findByRole('heading', { name: 'Calendar' });
  expect(router.state.location.pathname).toBe('/calendar');
  expect(sidebar().getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page');
  expect(sidebar().getByRole('link', { name: 'Activities' })).not.toHaveAttribute('aria-current');
  expect(main().getByRole('link', { name: 'Outlook agenda' })).toHaveAttribute('href', '/agenda');
  for (const name of ['Home', 'Library', 'Agenda', 'Notes'])
    expect(sidebar().queryByRole('link', { name })).toBeNull();
  for (const command of [
    'calendar_sync',
    'library_start_session',
    'library_process',
    'library_sources',
  ])
    expect(invoke).not.toHaveBeenCalledWith(command, expect.anything());
});
it('offers every day through native table buttons and every meeting through an untruncated selected-day list', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Calendar' });
  expect(within(main().getByRole('table')).getAllByRole('button')).toHaveLength(31);
  expect(day()).toHaveAccessibleName(
    /5 meetings.*1 with transcript, 2 without transcript, 2 unknown or unavailable/
  );
  day().focus();
  await userEvent.keyboard('{Enter}');
  const detail = within(main().getByRole('region', { name: 'Selected day meetings' }));
  for (const id of ['saved', 'none', 'empty', 'unknown', 'unavailable'])
    expect(detail.getByRole('button', { name: new RegExp(`Meeting ${id}`) })).toBeVisible();
  expect(detail.getByText('Transcript available')).toBeVisible();
  expect(detail.getByText('Empty transcript output')).toBeVisible();
  expect(detail.getByText('Transcript unavailable')).toBeVisible();
  expect(detail.getByText('Transcript status unknown')).toBeVisible();
  expect(detail.getAllByText(/No audio/)).toHaveLength(5);
});
it('filters explicit saved coverage without hiding an earlier transcript after a later failed job', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Calendar' });
  fireEvent.click(day());
  changeControl(main().getByRole('combobox', { name: 'Transcript coverage' }), {
    target: { value: 'available' },
  });
  const detail = within(main().getByRole('region', { name: 'Selected day meetings' }));
  expect(detail.getAllByRole('button')).toHaveLength(1);
  expect(detail.getByRole('button', { name: /Meeting saved/ })).toHaveTextContent(
    'Transcript available'
  );
  changeControl(main().getByRole('combobox', { name: 'Transcript coverage' }), {
    target: { value: 'without' },
  });
  expect(detail.getAllByRole('button')).toHaveLength(2);
  expect(detail.getByRole('button', { name: /Meeting none/ })).toBeVisible();
  expect(detail.getByRole('button', { name: /Meeting empty/ })).toBeVisible();
  expect(detail.queryByRole('button', { name: /Meeting unknown/ })).toBeNull();
  expect(detail.queryByRole('button', { name: /Meeting unavailable/ })).toBeNull();
});
it('keeps undated manual meetings discoverable and labels recorded-date fallback in the agenda list', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Calendar' });
  fireEvent.click(main().getByRole('button', { name: 'Agenda list' }));
  expect(
    within(main().getByRole('region', { name: 'Agenda list' })).getByRole('button', {
      name: /Meeting recorded/,
    })
  ).toHaveTextContent('Recorded date');
  expect(
    within(main().getByRole('region', { name: 'Agenda list' })).queryByRole('button', {
      name: /Meeting manual/,
    })
  ).toBeNull();
  expect(main().getByRole('link', { name: 'Undated meetings (1)' })).toHaveAttribute(
    'href',
    '#calendar-undated'
  );
  expect(
    within(main().getByRole('region', { name: 'Undated meetings' })).getByRole('button', {
      name: /Meeting manual/,
    })
  ).toHaveTextContent('Date not set');
  fireEvent.click(main().getByRole('button', { name: 'Next month' }));
  expect(
    within(main().getByRole('region', { name: 'Undated meetings' })).getByRole('button', {
      name: /Meeting manual/,
    })
  ).toBeVisible();
});
it(
  'retains sidebar filter, calendar period, selection and view independently across routes and sidebar remount',
  // Heavy route/remount integration: ~1.5s alone, slower under full-suite load.
  { timeout: 15_000 },
  async () => {
    const user = userEvent.setup();
    const { router } = mount();
    await screen.findByRole('heading', { name: 'Calendar' });
    fireEvent.click(sidebar().getByRole('button', { name: 'Filter sessions' }));
    changeControl(screen.getByRole('combobox', { name: 'Meeting period' }), {
      target: { value: 'custom' },
    });
    changeControl(screen.getByLabelText('From'), { target: { value: '2026-10-24' } });
    changeControl(screen.getByLabelText('Through (inclusive)'), {
      target: { value: '2026-10-24' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply dates' }));
    expect(sidebar().queryByRole('button', { name: /Meeting next/ })).toBeNull();
    await user.click(day());
    await user.click(
      within(main().getByRole('region', { name: 'Selected day meetings' })).getByRole('button', {
        name: /Meeting saved/,
      })
    );
    await screen.findByText('Existing session editor');
    expect(router.state.location.pathname).toBe('/sessions/saved');
    expect(sidebar().getByRole('button', { name: /Meeting saved/ })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(sidebar().getByRole('button', { name: /Filter sessions/ }));
    expect(screen.getByRole('combobox', { name: 'Meeting period' })).toHaveValue('custom');
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(sidebar().getByRole('button', { name: /Filter sessions/ }));
    expect(screen.getByRole('combobox', { name: 'Meeting period' })).toHaveValue('custom');
    await user.click(sidebar().getByRole('link', { name: 'Activities' }));
    await screen.findByText('Existing activity map');
    fireEvent.click(sidebar().getByRole('link', { name: 'Calendar' }));
    await screen.findByRole('heading', { name: 'Calendar' });
    expect(day()).toHaveAttribute('aria-pressed', 'true');
    expect(main().getByRole('combobox', { name: 'Calendar period' })).toHaveValue('all');
    fireEvent.click(main().getByRole('button', { name: 'Next month' }));
    expect(main().getByRole('combobox', { name: 'Calendar period' })).toHaveValue('all');
    expect(useSessionNavigation.getState().calendarPeriod).toEqual({ kind: 'all' });
    expect(useSessionNavigation.getState().sidebarPeriod).toEqual({
      kind: 'custom',
      start: '2026-10-24',
      end: '2026-10-24',
    });
    fireEvent.click(main().getByRole('button', { name: 'Agenda list' }));
    await act(async () => {
      await router.navigate({ to: '/' });
      await router.navigate({ to: '/calendar' });
    });
    expect(main().getByRole('button', { name: 'Agenda list' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(main().getByRole('heading', { name: 'November 2026' })).toBeVisible();
  }
);
it('resets empty filters and Today applies the current local month and day', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Calendar' });
  changeControl(main().getByRole('combobox', { name: 'Transcript coverage' }), {
    target: { value: 'available' },
  });
  fireEvent.click(main().getByRole('button', { name: 'Next month' }));
  expect(main().getByRole('status')).toHaveTextContent('outside the displayed month');
  fireEvent.click(main().getAllByRole('button', { name: 'Reset filters' })[0]);
  expect(main().queryByRole('status')).toBeNull();
  expect(useSessionNavigation.getState().calendarPeriod.kind).toBe('all');
  expect(useSessionNavigation.getState().transcript).toBe('all');
  fireEvent.click(main().getByRole('button', { name: 'Today' }));
  expect(useSessionNavigation.getState().selectedDay).toBe(dayKey(new Date()));
  expect(useSessionNavigation.getState().calendarPeriod.kind).toBe('all');
});
it('shows load failure with retry and restores sessions after a successful request', async () => {
  sessionListCache.setState({ data: undefined, isError: true, updatedAt: 0 });
  vi.mocked(invoke).mockRejectedValue(new Error('temporarily unavailable'));
  mount();
  await screen.findByRole('heading', { name: 'Calendar' });
  await waitFor(() => expect(main().getByRole('alert')).toBeVisible());
  expect(main().queryByText('No sessions yet. Create a meeting to begin.')).toBeNull();
  expect(main().queryByRole('table')).toBeNull();
  vi.mocked(invoke).mockResolvedValue(rows);
  fireEvent.click(main().getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(main().queryByRole('alert')).toBeNull());
  expect(day()).toHaveAccessibleName(/5 meetings/);
});
it('localizes navigation, calendar dates, filters and transcript coverage in Portuguese', async () => {
  await i18n.changeLanguage('pt-BR');
  mount();
  expect(await screen.findByRole('heading', { name: 'Calendário' })).toBeVisible();
  expect(sidebar().getByRole('link', { name: 'Atividades' })).toBeVisible();
  expect(main().getByRole('heading', { name: 'outubro de 2026' })).toBeVisible();
  expect(main().getByRole('combobox', { name: 'Cobertura de transcrição' })).toBeVisible();
  fireEvent.click(main().getByRole('button', { name: 'Lista de reuniões' }));
  expect(main().getByText('Transcrição disponível')).toBeVisible();
});

it('keeps the compact selector focused on preset changes and offers sidebar empty reset', async () => {
  rows = [scheduled('only', 24, 'available')];
  sessionListCache.setState({ data: rows });
  mount('/');
  await screen.findByText('Existing activity map');
  fireEvent.click(sidebar().getByRole('button', { name: 'Filter sessions' }));
  const selector = screen.getByRole('combobox', { name: 'Meeting period' });
  // Tomorrow is guaranteed outside Today, regardless of the current system date.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  rows = [{ ...rows[0], starts_at: tomorrow.toISOString() }];
  act(() => sessionListCache.setState({ data: rows }));
  changeControl(selector, { target: { value: 'today' } });
  expect(selector).toHaveFocus();
  expect(sidebar().queryByRole('button', { name: /Meeting only/ })).toBeNull();
  fireEvent.click(sidebar().getByRole('button', { name: 'Reset filters' }));
  expect(sidebar().getByRole('button', { name: /Meeting only/ })).toBeVisible();
  expect(selector).toHaveValue('all');
});
it('does not label an acknowledged recording link as no audio when recording metadata is pending', async () => {
  rows = [calendarSession('pending', { meeting_id: 'm', transcript_status: 'unavailable' })];
  sessionListCache.setState({ data: rows });
  mount();
  await screen.findByRole('heading', { name: 'Calendar' });
  const pending = within(main().getByRole('region', { name: 'Undated meetings' })).getByRole(
    'button',
    { name: /Meeting pending/ }
  );
  expect(pending).toHaveTextContent('Recording details pending');
  expect(pending).not.toHaveTextContent('No audio');
  expect(pending).toHaveTextContent('Transcript unavailable');
});

it('dismisses period popup on keyboard focus departure and keeps it closed after Enter navigates', async () => {
  const user = userEvent.setup();
  const { router } = mount('/calendar');
  await screen.findByRole('heading', { name: 'Calendar' });
  const filter = sidebar().getByRole('button', { name: 'Filter sessions' });
  await user.click(filter);
  expect(screen.getByRole('combobox', { name: 'Meeting period' })).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(filter).not.toHaveFocus();
  // Reopen and move focus directly to a navigation link before keyboard activation.
  await user.click(filter);
  const activities = sidebar().getByRole('link', { name: 'Activities' });
  act(() => activities.focus());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(activities).toHaveFocus();
  await user.keyboard('{Enter}');
  await screen.findByText('Existing activity map');
  expect(router.state.location.pathname).toBe('/');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(sidebar().getByRole('button', { name: 'Filter sessions' })).not.toHaveFocus();
});
it('opens the Outlook agenda from a header button-styled link instead of an underlined text link', async () => {
  const { router } = mount();
  await screen.findByRole('heading', { level: 1, name: 'Calendar' });
  const agenda = main().getByRole('link', { name: 'Outlook agenda' });
  expect(agenda).toHaveClass('cx-btn');
  expect(agenda).toHaveAttribute('data-variant', 'secondary');
  expect(agenda).not.toHaveClass('underline');
  fireEvent.click(agenda);
  await waitFor(() => expect(router.state.location.pathname).toBe('/agenda'));
});
