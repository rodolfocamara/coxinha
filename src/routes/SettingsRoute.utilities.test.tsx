import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsRoute } from './SettingsRoute';

const router = vi.hoisted(() => ({ navigate: vi.fn(), hash: '' }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => router.navigate,
  useLocation: () => ({ hash: router.hash }),
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
  view.props = {};
});
afterEach(cleanup);

it('renders only the settings view inside the shell, without the old frame or footer links', () => {
  render(<SettingsRoute />);
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(view.props.initialSection).toBeUndefined();
});

it('passes the hash as the section to land on, including legacy heading ids', () => {
  router.hash = 'integrations-heading';
  render(<SettingsRoute />);
  expect(view.props.initialSection).toBe('integrations-heading');
});

it('opens Reuniões (which absorbed the agenda) from the Outlook integration', () => {
  render(<SettingsRoute />);
  fireEvent.click(screen.getByRole('button', { name: 'open agenda' }));
  expect(router.navigate).toHaveBeenCalledWith({ to: '/meetings' });
});
