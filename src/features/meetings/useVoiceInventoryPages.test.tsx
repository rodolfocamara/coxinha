import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useVoiceInventoryPages, type InventoryPage } from './useVoiceInventoryPages';
type Row = { id: string };
const page = (
  items: string[],
  nextCursor: string | null = null,
  generation = 3
): InventoryPage<Row> => ({
  profileGeneration: generation,
  items: items.map((id) => ({ id })),
  nextCursor,
  scannedRows: items.length || 4096,
});
const read = vi.fn<(cursor: string | null) => Promise<InventoryPage<Row>>>();
const setup = () =>
  renderHook(
    ({ enabled, scope, version }) =>
      useVoiceInventoryPages(enabled, scope, version, read, (row) => row.id),
    { initialProps: { enabled: true, scope: 'person-a', version: 'v1' } }
  );
beforeEach(() => {
  read.mockReset();
  read.mockResolvedValue(page(['a']));
});
it('does not auto-drain pages and single-flights repeated load-more actions with deduplication', async () => {
  read.mockResolvedValueOnce(page(['a'], 'next'));
  let finish!: (value: InventoryPage<Row>) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result } = setup();
  await waitFor(() => expect(result.current.items).toEqual([{ id: 'a' }]));
  expect(read).toHaveBeenCalledTimes(1);
  act(() => {
    result.current.loadMore();
    result.current.loadMore();
  });
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => finish(page(['a', 'b'])));
  expect(result.current.items.map((row) => row.id)).toEqual(['a', 'b']);
  expect(result.current.more).toBe(false);
});
it('keeps an empty progress page incomplete until explicit continuation reaches null', async () => {
  read.mockResolvedValueOnce(page([], 'scan')).mockResolvedValueOnce(page(['a']));
  const { result } = setup();
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.more).toBe(true);
  expect(result.current.scannedRows).toBe(4096);
  expect(read).toHaveBeenCalledTimes(1);
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.more).toBe(false));
  expect(result.current.items[0].id).toBe('a');
});
it('rejects a generation-mismatched append and explicitly restarts from null', async () => {
  read
    .mockResolvedValueOnce(page(['a'], 'old'))
    .mockResolvedValueOnce(page(['foreign'], null, 4))
    .mockResolvedValueOnce(page(['new'], null, 4));
  const { result } = setup();
  await waitFor(() => expect(result.current.more).toBe(true));
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.stale).toBe(true));
  expect(result.current.items.map((row) => row.id)).toEqual(['a']);
  expect(result.current.fresh).toBe(false);
  act(() => result.current.loadMore());
  expect(read).toHaveBeenCalledTimes(2);
  act(() => result.current.restart());
  await waitFor(() => expect(result.current.fresh).toBe(true));
  expect(result.current.items[0].id).toBe('new');
  expect(read).toHaveBeenLastCalledWith(null);
});
it('ignores an old append after restart even when its scope and generation look identical', async () => {
  let finish!: (value: InventoryPage<Row>) => void;
  read
    .mockResolvedValueOnce(page(['a'], 'old'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValueOnce(page(['new']));
  const { result } = setup();
  await waitFor(() => expect(result.current.more).toBe(true));
  act(() => result.current.loadMore());
  act(() => result.current.restart());
  await waitFor(() => expect(result.current.items[0]?.id).toBe('new'));
  await act(async () => finish(page(['late'])));
  expect(result.current.items.map((row) => row.id)).toEqual(['new']);
});
it('never exposes or appends late items from another person scope', async () => {
  let finish!: (value: InventoryPage<Row>) => void;
  read
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValueOnce(page(['person-b']));
  const { result, rerender } = setup();
  rerender({ enabled: true, scope: 'person-b', version: 'v1' });
  await waitFor(() => expect(result.current.items[0]?.id).toBe('person-b'));
  await act(async () => finish(page(['person-a'])));
  expect(result.current.items.map((row) => row.id)).toEqual(['person-b']);
});
it('marks loaded rows stale after a mutation version change without silently replacing them', async () => {
  const { result, rerender } = setup();
  await waitFor(() => expect(result.current.fresh).toBe(true));
  rerender({ enabled: true, scope: 'person-a', version: 'v2' });
  expect(result.current.fresh).toBe(false);
  expect(result.current.items[0].id).toBe('a');
  expect(result.current.stale).toBe(true);
  expect(read).toHaveBeenCalledTimes(1);
  read.mockResolvedValueOnce(page(['fresh'], null, 4));
  act(() => result.current.restart());
  await waitFor(() => expect(result.current.fresh).toBe(true));
  expect(result.current.items[0].id).toBe('fresh');
});
it('retries a busy continuation at the same cursor and treats cursor cycles as restart-required', async () => {
  read
    .mockResolvedValueOnce(page(['a'], 'next'))
    .mockRejectedValueOnce('voice_curation_busy')
    .mockResolvedValueOnce(page(['b'], 'next'));
  const { result } = setup();
  await waitFor(() => expect(result.current.more).toBe(true));
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.error).toBe('voice_curation_busy'));
  expect(result.current.items[0].id).toBe('a');
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.stale).toBe(true));
  expect(result.current.error).toBe('voice_curation_cursor_invalid');
  expect(result.current.items.map((row) => row.id)).toEqual(['a']);
  expect(read.mock.calls.slice(1)).toEqual([['next'], ['next']]);
});
it('discards replies when a disclosure closes and does not mutate state after disposal', async () => {
  let finish!: (value: InventoryPage<Row>) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result, rerender, unmount } = setup();
  rerender({ enabled: false, scope: 'person-a', version: 'v1' });
  await act(async () => finish(page(['late'])));
  expect(result.current.items).toEqual([]);
  expect(result.current.fresh).toBe(false);
  unmount();
});

it('propagates a person refresh-required error to its metadata snapshot without appending or authorizing rows', async () => {
  const onStale = vi.fn();
  read
    .mockResolvedValueOnce(page(['a'], 'next'))
    .mockRejectedValueOnce('voice_curation_refresh_required');
  const { result } = renderHook(() =>
    useVoiceInventoryPages(true, 'person-a', 'v1', read, (row) => row.id, {
      generation: 3,
      onStale,
    })
  );
  await waitFor(() => expect(result.current.more).toBe(true));
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.stale).toBe(true));
  expect(result.current.fresh).toBe(false);
  expect(result.current.items.map((row) => row.id)).toEqual(['a']);
  expect(onStale).toHaveBeenCalledOnce();
});
