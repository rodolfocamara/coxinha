import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { library, type ProcessingDetail } from './library';
import { useProcessing } from './useProcessing';
vi.mock('./library', () => ({ library: { processing: vi.fn() } }));
const empty: ProcessingDetail = { jobs: [], report: null, people: [] };
const idle = { active: null, error: null };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(library.processing).mockResolvedValue(empty);
});
it('ignores a stale old-job fetch and loads historical jobs explicitly', async () => {
  let finish!: (data: ProcessingDetail) => void;
  vi.mocked(library.processing).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result } = renderHook(() => useProcessing('m', idle));
  act(() => result.current.setJob('older-job'));
  await waitFor(() => expect(library.processing).toHaveBeenLastCalledWith('m', 'older-job'));
  await waitFor(() => expect(result.current.data).toEqual(empty));
  await act(async () => finish({ ...empty, people: [{ id: 'stale', name: 'Stale' }] }));
  expect(result.current.data?.people).toEqual([]);
});
it('rejects stale meeting responses and stale mutation refetches', async () => {
  let finish!: () => void;
  const { result, rerender } = renderHook(({ meeting }) => useProcessing(meeting, idle), {
    initialProps: { meeting: 'old' },
  });
  await waitFor(() => expect(result.current.data).toEqual(empty));
  let mutation!: Promise<void>;
  act(() => {
    mutation = result.current.act(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
  });
  rerender({ meeting: 'new' });
  await waitFor(() => expect(library.processing).toHaveBeenLastCalledWith('new', undefined));
  await act(async () => {
    finish();
    await mutation;
  });
  expect(library.processing).toHaveBeenCalledTimes(2);
  expect(result.current.busy).toBe(false);
});
it('guards duplicate synchronous mutations and reconciles persisted partial failures', async () => {
  const { result } = renderHook(() => useProcessing('m', idle));
  await waitFor(() => expect(result.current.data).toEqual(empty));
  let fail!: (e: Error) => void;
  const command = vi.fn(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      })
  );
  let first!: Promise<void>;
  act(() => {
    first = result.current.act(command);
    void result.current.act(command);
  });
  expect(command).toHaveBeenCalledTimes(1);
  vi.mocked(library.processing).mockResolvedValue({
    ...empty,
    people: [{ id: 'saved', name: 'Saved' }],
  });
  await act(async () => {
    fail(new Error('optional enrollment failed'));
    await first;
  });
  expect(result.current.error).toContain('optional enrollment failed');
  expect(result.current.data?.people[0].id).toBe('saved');
  expect(result.current.busy).toBe(false);
});

it('retains the same scope during a phase refresh and after a failed refresh', async () => {
  const saved = { ...empty, people: [{ id: 'known', name: 'Known' }] };
  vi.mocked(library.processing).mockResolvedValue(saved);
  const { result, rerender } = renderHook(
    ({ phase }) =>
      useProcessing('m', { ...idle, processing: { meetingId: 'm', job: 'new', phase } }),
    { initialProps: { phase: 'validation' } }
  );
  await waitFor(() => expect(result.current.data).toEqual(saved));
  let fail!: (error: Error) => void;
  vi.mocked(library.processing).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      })
  );
  rerender({ phase: 'inference' });
  expect(result.current.data).toEqual(saved);
  await act(async () => fail(new Error('refresh offline')));
  expect(result.current.data).toEqual(saved);
  expect(result.current.error).toContain('refresh offline');
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.error).toBeNull());
  expect(result.current.data).toEqual(saved);
});

it('never exposes retained data from a different meeting or explicit job', async () => {
  const saved = { ...empty, people: [{ id: 'private', name: 'Private' }] };
  vi.mocked(library.processing).mockResolvedValue(saved);
  const { result, rerender } = renderHook(({ meeting }) => useProcessing(meeting, idle), {
    initialProps: { meeting: 'one' },
  });
  await waitFor(() => expect(result.current.data).toEqual(saved));
  vi.mocked(library.processing).mockImplementation(() => new Promise(() => {}));
  act(() => result.current.setJob('historical'));
  expect(result.current.data).toBeNull();
  rerender({ meeting: 'two' });
  expect(result.current.data).toBeNull();
});
