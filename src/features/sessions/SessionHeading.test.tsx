import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { SessionHeading } from './SessionHeading';
import type { Session } from './sessions';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
const session = {
  id: 'one',
  title: 'Canonical title',
  starts_at: '2026-10-24T12:00:00Z',
  ends_at: null,
  status: 'planned',
} as Session;
beforeEach(async () => {
  vi.mocked(invoke).mockReset();
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});
it('shows one canonical heading and opens rename only on explicit action, Escape cancels without mutation', () => {
  render(<SessionHeading session={session} refresh={vi.fn()} />);
  expect(screen.getAllByText('Canonical title')).toHaveLength(1);
  expect(screen.queryByRole('textbox')).toBeNull();
  const rename = screen.getByRole('button', { name: 'Rename session' });
  fireEvent.click(rename);
  const input = screen.getByRole('textbox', { name: 'Session title' });
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: 'Uncommitted' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(rename).toHaveFocus();
  expect(invoke).not.toHaveBeenCalled();
});
it('saves only after explicit rename submission and closes the form after refresh', async () => {
  vi.mocked(invoke).mockResolvedValue(session);
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<SessionHeading session={session} refresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rename session' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Renamed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save title' }));
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(invoke).toHaveBeenCalledWith('library_update_session', {
    sessionId: 'one',
    input: { title: 'Renamed', starts_at: session.starts_at, ends_at: null, status: 'planned' },
  });
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Rename session' })).toHaveFocus();
});
it('retains the draft and exposes failure instead of closing rename on rejected update', async () => {
  vi.mocked(invoke).mockRejectedValue('failed');
  render(<SessionHeading session={session} refresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rename session' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Retained title' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save title' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not update');
  expect(screen.getByRole('textbox')).toHaveValue('Retained title');
});
it('formats session metadata dates with the selected application language', async () => {
  await i18n.changeLanguage('pt-BR');
  const date = vi.spyOn(Date.prototype, 'toLocaleString');
  render(<SessionHeading session={session} refresh={vi.fn()} />);
  expect(date).toHaveBeenCalledWith('pt-BR');
  expect(screen.getByRole('button', { name: 'Renomear sessão' })).toBeInTheDocument();
});

it('offers agenda navigation as a button-styled link and rename as an icon button', () => {
  render(<SessionHeading session={session} refresh={vi.fn()} />);
  const agenda = screen.getByRole('link', { name: 'Open agenda' });
  expect(agenda).toHaveAttribute('href', '/agenda');
  expect(agenda).toHaveClass('cx-btn');
  expect(agenda).toHaveAttribute('data-variant', 'ghost');
  expect(agenda).not.toHaveClass('underline');
  const rename = screen.getByRole('button', { name: 'Rename session' });
  expect(rename).toHaveAttribute('data-icon-only', 'true');
  fireEvent.click(rename);
  expect(screen.getByRole('textbox', { name: 'Session title' })).toHaveClass('cx-input');
  expect(screen.getByRole('button', { name: 'Save title' })).toHaveAttribute(
    'data-variant',
    'primary'
  );
});
