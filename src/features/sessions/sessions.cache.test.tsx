import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { sessionListCache, useSessions, type Session } from './sessions';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('does not continually invalidate a slow list request on periodic polling', async () => {
  vi.useFakeTimers();
  sessionListCache.setState({ data: undefined, isError: false, updatedAt: 0 });
  let resolve!: (value: Session[]) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  function List() {
    const { data } = useSessions();
    return <p>{data?.map((s) => s.title).join(',') ?? 'Loading'}</p>;
  }
  render(<List />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => resolve([{ id: 'slow', title: 'Slow but current' } as Session]));
  expect(screen.getByText('Slow but current')).toBeInTheDocument();
  expect(invoke).toHaveBeenCalledTimes(1);
});
