import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '../../lib/i18n';
import { ChromeCap } from './ChromeCap';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }));
afterEach(cleanup);

it('presents a single page once without a pretend tab', () => {
  render(
    <ChromeCap
      trail={['Meeting library']}
      tabs={[{ id: 'meetings', label: 'Meeting library', active: true }]}
    />
  );
  expect(screen.getAllByText('Meeting library')).toHaveLength(1);
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('keeps a hierarchical breadcrumb without repeating the active note', () => {
  render(
    <ChromeCap
      trail={['Board', 'Planning.md']}
      tabs={[{ id: 'note', label: 'Planning.md', active: true }]}
    />
  );
  expect(screen.getByText('Board')).toBeVisible();
  expect(screen.getAllByText('Planning.md')).toHaveLength(1);
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
});

it('uses the route title when a single caller supplies no breadcrumb', () => {
  render(<ChromeCap tabs={[{ id: 'board', label: 'Board', active: true }]} />);
  expect(screen.getByText('Board')).toBeVisible();
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
});

it('retains activation and close actions for multiple real open tabs', () => {
  const activate = vi.fn();
  const close = vi.fn();
  render(
    <ChromeCap
      trail={['Board', 'Planning.md']}
      tabs={[
        { id: 'first', label: 'Planning.md', active: true, onClose: close },
        { id: 'second', label: 'Ideas.md', active: false, onActivate: activate },
      ]}
    />
  );
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(screen.getAllByText('Planning.md')).toHaveLength(1);
  fireEvent.click(screen.getByRole('tab', { name: 'Ideas.md' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close tab' }));
  expect(activate).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
