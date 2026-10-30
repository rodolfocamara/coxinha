import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { SessionSidebar } from './SessionSidebar';
import { SessionGroups } from './SessionList';
import { calendarSession } from './calendarFixtures';
import { useSessionNavigation } from './sessionNavigation';
import { useSessionSidebarPreferences } from './sidebarPreferences';
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), rows: [] as unknown[] }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useMatchRoute:
    () =>
    ({ params }: { params: { sessionId: string } }) =>
      params.sessionId === 'active',
}));
vi.mock('./sessions', () => ({
  sessions: { available: () => true },
  useSessions: () => ({ data: mocks.rows, isPending: false, isError: false }),
  useRefreshSessions: () => vi.fn(),
}));
beforeEach(async () => {
  await i18n.changeLanguage('en');
  mocks.navigate.mockClear();
  mocks.rows = [
    calendarSession('active', { title: 'Primary meeting', starts_at: '2026-10-24T12:00:00Z' }),
    calendarSession('undated', { title: 'Undated meeting' }),
  ];
  useSessionNavigation.setState({ sidebarPeriod: { kind: 'all' } });
  useSessionSidebarPreferences.setState({ collapsed: false, groups: [] });
});
afterEach(cleanup);
it('keeps the section label static and collapses only dates across remounts', async () => {
  const user = userEvent.setup();
  useSessionSidebarPreferences.setState({ collapsed: true, groups: [] });
  render(<SessionSidebar />);
  expect(screen.getByRole('heading', { name: 'Meeting sessions' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Meeting sessions' })).toBeNull();
  expect(screen.getByRole('button', { name: /Primary meeting/ })).toBeVisible();
  const date = screen.getByRole('button', { name: 'Saturday, October 24, 2026' });
  date.focus();
  await user.keyboard(' ');
  expect(date).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('button', { name: /Primary meeting/ })).toBeNull();
  expect(JSON.parse(localStorage.getItem('coxinha:session-sidebar')!)).toMatchObject({
    groups: ['2026-10-24'],
  });
  cleanup();
  render(<SessionSidebar />);
  expect(screen.getByRole('button', { name: 'Saturday, October 24, 2026' })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  expect(screen.getByRole('button', { name: /Undated meetingDate not set/ })).toBeVisible();
});
it('opens only existing period controls and restores focus on Escape but not outside interaction', async () => {
  render(<SessionSidebar />);
  expect(screen.queryByRole('combobox')).toBeNull();
  const trigger = screen.getByRole('button', { name: 'Filter sessions' });
  fireEvent.click(trigger);
  expect(screen.getByRole('combobox', { name: 'Meeting period' })).toHaveFocus();
  expect(screen.queryByRole('combobox', { name: /transcript/i })).toBeNull();
  expect(screen.getByRole('dialog')).toHaveClass('session-period-popup');
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger).not.toHaveFocus();
});
it('retains an active custom period through remounts, keeps undated access and selected session', () => {
  useSessionNavigation.setState({
    sidebarPeriod: { kind: 'custom', start: '2026-10-24', end: '2026-10-24' },
  });
  const view = render(<SessionSidebar />);
  expect(screen.getByRole('button', { name: /Primary meeting/ })).toHaveAttribute(
    'aria-current',
    'page'
  );
  fireEvent.click(screen.getByRole('button', { name: /Primary meeting/ }));
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: '/sessions/$sessionId',
    params: { sessionId: 'active' },
  });
  view.unmount();
  render(<SessionSidebar />);
  fireEvent.click(screen.getByRole('button', { name: /Filter sessions \(period filter active\)/ }));
  expect(screen.getByRole('combobox')).toHaveValue('custom');
  expect(screen.getByRole('dialog')).toHaveTextContent('10/24/2026');
  expect(screen.getByRole('button', { name: /Undated meetingDate not set/ })).toBeVisible();
});
it('never applies sidebar date collapse to Calendar full-view groups', () => {
  useSessionSidebarPreferences.setState({ groups: ['2026-10-24'], collapsed: true });
  render(
    <SessionGroups
      rows={[
        calendarSession('active', {
          title: 'Full calendar meeting',
          starts_at: '2026-10-24T12:00:00Z',
        }),
      ]}
    />
  );
  expect(screen.getByRole('button', { name: /Full calendar meeting/ })).toBeVisible();
  expect(within(screen.getByRole('heading')).queryByRole('button')).toBeNull();
});

it('dismisses on outside keyboard focus and preserves the intended destination focus', async () => {
  const user = userEvent.setup();
  render(
    <>
      <SessionSidebar />
      <button>Outside destination</button>
    </>
  );
  const trigger = screen.getByRole('button', { name: 'Filter sessions' });
  await user.click(trigger);
  expect(screen.getByRole('combobox')).toHaveFocus();
  // The popup portal is last in DOM order. Tab moves to the next outside control.
  await user.tab();
  const destination = document.activeElement;
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger).not.toHaveFocus();
  expect(document.activeElement).toBe(destination);
  await user.click(trigger);
  const button = screen.getByRole('button', { name: 'Outside destination' });
  await user.click(button);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(button).toHaveFocus();
});

it('keeps the period popup open when its non-control surface is clicked', async () => {
  const user = userEvent.setup();
  render(<SessionSidebar />);
  await user.click(screen.getByRole('button', { name: 'Filter sessions' }));
  const popup = screen.getByRole('dialog', { name: 'Meeting period' });
  expect(screen.getByRole('combobox')).toHaveFocus();
  await user.click(popup);
  expect(popup).toBeVisible();
  expect(popup).toHaveFocus();
  await user.click(screen.getByRole('combobox'));
  expect(screen.getByRole('listbox')).toBeVisible();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(popup).toBeVisible();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: 'Filter sessions' })).toHaveFocus();
});
