import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HojeRoute } from './HojeRoute';
import { data, panel, setupHoje, teardownHoje } from './hojeTestHarness';
import { resetOutlookCategories } from '../agenda/categories';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tanstack/react-router', async () => {
  const { navigate } = await import('./hojeTestHarness');
  return { useNavigate: () => navigate };
});
vi.mock('../../lib/motion', async () => (await import('./hojeTestHarness')).motion);
vi.mock('../board/persistence', async () => ({
  boardSession: (await import('./hojeTestHarness')).boardSession,
}));

beforeEach(async () => {
  await setupHoje();
  resetOutlookCategories();
});
afterEach(teardownHoje);

it('marks agenda rows with the event category colour (spec 0103)', async () => {
  const calendar = data.current.calendar as {
    events: { id: string; categories?: string[] }[];
  } & Record<string, unknown>;
  calendar.categories = [{ name: 'Manager', preset: 3 }];
  calendar.categoryAccess = { read: true, write: true };
  calendar.events.find((e) => e.id === 'e-weekly')!.categories = ['Manager'];
  render(<HojeRoute />);
  const agenda = await waitFor(() => panel(/Agenda/));
  const weekly = (await within(agenda).findByText('Weekly de TI')).closest('button')!;
  await waitFor(() => expect(weekly).toHaveAttribute('data-category', 'yellow'));
  expect(weekly.style.getPropertyValue('--cx-cat')).toBe('var(--outlook-cat-3)');
  expect(weekly).toHaveAccessibleName(/Categoria Manager/);
  const focus = screen.getByText('Bloco de foco').closest('button')!;
  expect(focus).not.toHaveAttribute('data-category');
});
