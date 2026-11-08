import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsRoute } from './SettingsRoute';

const router = vi.hoisted(() => ({ navigate: vi.fn(), hash: '', section: 'appearance' }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => router.navigate,
  useLocation: () => ({ hash: router.hash }),
  useParams: () => ({ section: router.section }),
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
  router.section = 'appearance';
  view.props = {};
});
afterEach(cleanup);

it('renders only the settings view inside the shell, without the old frame or footer links', () => {
  render(<SettingsRoute />);
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(view.props.target).toBeUndefined();
});

it('passes the page and the row to land on', () => {
  router.section = 'storage';
  router.hash = 'rebuild-heading';
  render(<SettingsRoute />);
  expect(view.props.section).toBe('storage');
  expect(view.props.target).toBe('rebuild-heading');
});

it('moves between pages through the router, row included', () => {
  render(<SettingsRoute />);
  (view.props.onNavigate as (section: string, target?: string) => void)(
    'titles',
    'summaries-heading'
  );
  expect(router.navigate).toHaveBeenCalledWith({
    to: '/settings/$section',
    params: { section: 'titles' },
    hash: 'summaries-heading',
  });
});

it('opens Reuniões (which absorbed the agenda) from the Outlook integration', () => {
  render(<SettingsRoute />);
  fireEvent.click(screen.getByRole('button', { name: 'open agenda' }));
  expect(router.navigate).toHaveBeenCalledWith({ to: '/meetings' });
});
