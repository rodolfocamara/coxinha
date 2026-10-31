import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

const getBacklinks = vi.fn();
vi.mock('../../lib/bindings', () => ({
  commands: {
    getBacklinks: (...a: unknown[]) => getBacklinks(...a),
  },
}));

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

import { BacklinksPanel } from './BacklinksPanel';

function note(id: string, title: string) {
  return {
    id,
    title,
    path: `notes/${id}.md`,
    tags: [],
    created_at: '2026-04-19T00:00:00Z',
    updated_at: '2026-04-19T00:00:00Z',
  };
}

beforeEach(() => {
  getBacklinks.mockReset();
  navigate.mockReset();
});

describe('BacklinksPanel', () => {
  it('renders the empty state when no backlinks come back', async () => {
    getBacklinks.mockResolvedValue({ status: 'ok', data: [] });

    render(<BacklinksPanel noteId="target" />);

    expect(await screen.findByText('backlinks.empty')).toBeInTheDocument();
    expect(getBacklinks).toHaveBeenCalledWith('target');
  });

  it('lists linker notes with title text', async () => {
    getBacklinks.mockResolvedValue({
      status: 'ok',
      data: [note('a', 'Alpha'), note('b', 'Beta')],
    });

    render(<BacklinksPanel noteId="target" />);

    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('navigates to the linker note on click', async () => {
    const user = userEvent.setup();
    getBacklinks.mockResolvedValue({
      status: 'ok',
      data: [note('a', 'Alpha')],
    });

    render(<BacklinksPanel noteId="target" />);
    await user.click(await screen.findByRole('button', { name: 'Alpha' }));

    expect(navigate).toHaveBeenCalledWith({
      to: '/workspace/$noteId',
      params: { noteId: 'a' },
    });
  });

  it('surfaces backend errors in an alert', async () => {
    getBacklinks.mockResolvedValue({ status: 'error', error: 'boom' });

    render(<BacklinksPanel noteId="target" />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('backlinks.unavailable');
    expect(alert).not.toHaveTextContent('boom');
    expect(getBacklinks).toHaveBeenCalledTimes(1);
  });

  it('turns rejected IPC into an actionable error without repeated requests', async () => {
    getBacklinks.mockRejectedValue(new Error('private transport detail'));
    const { rerender } = render(<BacklinksPanel noteId="target" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('backlinks.unavailable');
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<BacklinksPanel noteId="target" />);
    await waitFor(() => expect(getBacklinks).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('private transport detail')).toBeNull();
  });

  it('falls back to "(untitled)" when the linker has no title', async () => {
    getBacklinks.mockResolvedValue({
      status: 'ok',
      data: [note('a', '')],
    });

    render(<BacklinksPanel noteId="target" />);

    expect(await screen.findByText('sidebar.untitled')).toBeInTheDocument();
  });

  it('refetches when the active noteId changes', async () => {
    getBacklinks.mockResolvedValue({ status: 'ok', data: [] });

    const { rerender } = render(<BacklinksPanel noteId="first" />);
    await waitFor(() => expect(getBacklinks).toHaveBeenCalledWith('first'));

    rerender(<BacklinksPanel noteId="second" />);
    await waitFor(() => expect(getBacklinks).toHaveBeenCalledWith('second'));
  });
});
