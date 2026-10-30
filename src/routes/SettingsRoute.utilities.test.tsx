import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsRoute } from './SettingsRoute';

const router = vi.hoisted(() => ({ navigate: vi.fn(), hash: '' }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => router.navigate,
  useLocation: () => ({ hash: router.hash }),
}));
vi.mock('../components/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
const view = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));
vi.mock('../features/settings/SettingsView', () => ({
  SettingsView: (props: { onOpenAgenda?: () => void }) => {
    view.props = props;
    return <button onClick={props.onOpenAgenda}>open agenda</button>;
  },
}));
beforeEach(() => {
  router.navigate.mockReset();
  router.hash = '';
});
afterEach(cleanup);

it('scrolls settings inside the shell canvas, which clips its own overflow', () => {
  render(<SettingsRoute />);
  expect(screen.getByTestId('settings-scroll')).toHaveClass('h-full', 'overflow-auto');
});

it('keeps features in Settings sections, not footer text links', () => {
  render(<SettingsRoute />);
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.queryByRole('navigation')).toBeNull();
});

it('lets the Outlook integration open the agenda and honours a requested section', () => {
  router.hash = 'integrations-heading';
  render(<SettingsRoute />);
  expect(view.props.initialSection).toBe('integrations-heading');
  fireEvent.click(screen.getByRole('button', { name: 'open agenda' }));
  expect(router.navigate).toHaveBeenCalledWith({ to: '/agenda' });
});
