import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { resetSystemChords, useShortcutScope, useSystemChords } from '../../lib/shortcuts';
import type { ShortcutReport } from '../../lib/bindings';
import { OPEN_SHORTCUTS_EVENT, ShortcutSheet } from './ShortcutSheet';
import { ShortcutNotice } from './ShortcutNotice';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

beforeEach(async () => {
  await i18n.changeLanguage('en');
  resetSystemChords();
  navigate.mockClear();
});
afterEach(cleanup);

const press = () => fireEvent.keyDown(window, { key: '?', shiftKey: true });
const group = (scope: string) => document.querySelector(`[data-shortcut-scope="${scope}"]`);

it('? lists the shortcuts of the screen on show, and only those', async () => {
  render(<ShortcutSheet />);
  renderHook(() => useShortcutScope('board'));
  expect(screen.queryByRole('dialog')).toBeNull();
  press();
  const sheet = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
  expect(group('board')).toHaveTextContent('Remove the selection');
  expect(group('calendar')).toBeNull();
  expect(group('note')).toBeNull();
  expect(group('app')).toHaveTextContent('Show keyboard shortcuts');
  expect(within(sheet).getByText('Ctrl+Alt+T')).toBeInTheDocument();
});

it('follows the screen: the calendar lists its keys', async () => {
  render(<ShortcutSheet />);
  renderHook(() => useShortcutScope('calendar'));
  press();
  await screen.findByRole('dialog');
  expect(group('calendar')).toHaveTextContent('Go to today');
  expect(group('board')).toBeNull();
});

it('shows a system chord as rebound, not as the default', async () => {
  useSystemChords.setState({
    loaded: true,
    report: {
      wayland: false,
      statuses: [{ action: 'meetings', chord: 'Ctrl+Alt+M' }],
    } as unknown as ShortcutReport,
  });
  render(<ShortcutSheet />);
  press();
  await screen.findByRole('dialog');
  const row = document.querySelector('[data-shortcut="system.meetings"]')!;
  expect(row).toHaveTextContent('Ctrl+Alt+M');
  expect(row).not.toHaveTextContent('Ctrl+Alt+T');
});

it('does not open from a text field', () => {
  render(
    <>
      <ShortcutSheet />
      <input aria-label="field" />
    </>
  );
  fireEvent.keyDown(screen.getByLabelText('field'), { key: '?', shiftKey: true });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('opens from the palette action and closes with Esc', async () => {
  render(<ShortcutSheet />);
  act(() => void window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT)));
  const sheet = await screen.findByRole('dialog');
  fireEvent.keyDown(sheet, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

const failedReport = {
  wayland: false,
  statuses: [
    { action: 'meetings', chord: 'Ctrl+Alt+T', failure: 'taken', conflict: null },
    { action: 'agenda', chord: 'Ctrl+Alt+G', failure: null, conflict: 'Fixture Terminal' },
    { action: 'new_note', chord: 'Ctrl+Alt+Y', failure: null, conflict: null },
  ],
} as unknown as ShortcutReport;

it('tells the user outside Settings when a chord failed, with a way to fix it', () => {
  useSystemChords.setState({ report: failedReport, loaded: true });
  render(<ShortcutNotice />);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Ctrl+Alt+T, Ctrl+Alt+G');
  expect(alert).not.toHaveTextContent('Ctrl+Alt+Y');
  fireEvent.click(screen.getByRole('button', { name: 'Review shortcuts' }));
  expect(navigate).toHaveBeenCalledWith(
    expect.objectContaining({ params: { section: 'shortcuts' } })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('says nothing when every chord works, or before the desktop answers', () => {
  const { rerender } = render(<ShortcutNotice />);
  expect(screen.queryByRole('alert')).toBeNull();
  useSystemChords.setState({
    report: { wayland: false, statuses: [failedReport.statuses[2]] },
    loaded: true,
  });
  rerender(<ShortcutNotice />);
  expect(screen.queryByRole('alert')).toBeNull();
});
