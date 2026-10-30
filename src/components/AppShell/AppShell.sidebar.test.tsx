import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useSidebar } from '../../lib/sidebar';
import { AppShell } from './AppShell';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useMatchRoute: () => () => false,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./RecordingStatus', () => ({ RecordingStatus: () => null }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }));

beforeEach(() => useSidebar.getState().setOpen(true));
afterEach(() => {
  cleanup();
  localStorage.clear();
});

it('fully hides the sidebar, restores it and hands keyboard focus to the new toggle', () => {
  render(
    <AppShell>
      <p>Canvas</p>
    </AppShell>
  );
  const collapse = screen.getByRole('button', { name: 'chrome.collapseSidebar' });
  expect(collapse).toHaveAttribute('aria-expanded', 'true');
  expect(collapse).toHaveAttribute('aria-controls', 'workspace-sidebar');
  collapse.focus();
  fireEvent.click(collapse);
  expect(screen.queryByRole('navigation', { name: 'a11y.mainNavigation' })).toBeNull();
  const expand = screen.getByRole('button', { name: 'chrome.expandSidebar' });
  expect(expand).toHaveFocus();
  expect(expand).toHaveAttribute('aria-expanded', 'false');
  expect(expand).not.toHaveAttribute('aria-controls');
  expect(screen.getByRole('img', { name: 'brand.name' })).toBeInTheDocument();
  fireEvent.click(expand);
  expect(screen.getByRole('button', { name: 'chrome.collapseSidebar' })).toHaveFocus();
  expect(screen.getByRole('navigation', { name: 'a11y.mainNavigation' })).toBeInTheDocument();
});

it('retains labeled destinations and functional search without obsolete actions', () => {
  const palette = vi.fn();
  window.addEventListener('coxinha:open-palette', palette);
  render(
    <AppShell>
      <p>Canvas</p>
    </AppShell>
  );
  for (const [name, path] of [['nav.settings', '/settings']]) {
    expect(screen.getByRole('link', { name })).toHaveAttribute('href', path);
  }
  for (const name of ['nav.home', 'library.title', 'nav.notes', 'nav.agenda'])
    expect(screen.queryByRole('link', { name })).toBeNull();
  expect(screen.getByRole('button', { name: 'session.map' })).toBeInTheDocument();
  const search = screen.getByRole('button', { name: 'rail.search' });
  expect(search.querySelector('kbd')).toHaveAttribute('aria-hidden', 'true');
  expect(search.querySelector('kbd')).toHaveTextContent(/Ctrl K|⌘ K/);
  fireEvent.click(search);
  expect(palette).toHaveBeenCalledOnce();
  window.removeEventListener('coxinha:open-palette', palette);
  for (const name of [
    'chrome.back',
    'chrome.forward',
    'rail.workspaceOptions',
    'rail.quick.messages',
    'rail.newMeetingNote',
  ]) {
    expect(screen.queryByRole('button', { name })).toBeNull();
  }
  expect(screen.queryByText('rail.sections.aiMeetingNotes')).toBeNull();
});

it('retains custom rail overrides while the sidebar can collapse', () => {
  render(
    <AppShell rail={<p>Custom navigation</p>}>
      <p>Canvas</p>
    </AppShell>
  );
  expect(screen.getByText('Custom navigation')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'chrome.collapseSidebar' }));
  expect(screen.queryByText('Custom navigation')).toBeNull();
});

it('exposes the meeting library in the rail instead of only through text links', () => {
  render(
    <AppShell>
      <p>Canvas</p>
    </AppShell>
  );
  const nav = screen.getByRole('navigation', { name: 'a11y.mainNavigation' });
  const links = [...nav.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
  const calendar = links.findIndex(([, href]) => href === '/calendar');
  const library = links.findIndex(([, href]) => href === '/meetings');
  expect(links[library]?.[0]).toBe('rail.recordings');
  // Placed right after Calendar, before People.
  expect(library).toBe(calendar + 1);
});
