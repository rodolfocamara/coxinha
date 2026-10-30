import { QueryClient } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { persistNote } from './notePersistence';
import { useAppStore } from './store';
import { invoke } from '@tauri-apps/api/core';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const note = { id: 'A', title: 'A', created_at: '', updated_at: '', tags: [], file_path: 'A.md' };
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useAppStore.setState({ notes: [] });
});
it('reopening a note reads the last durable Markdown from the infinite-stale loader cache', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(['note', 'A'], { note, markdown: 'old' });
  vi.mocked(invoke).mockResolvedValue(note);
  await persistNote(client, 'A', 'latest durable edit');
  const fetch = vi.fn();
  const reopened = await client.ensureQueryData({ queryKey: ['note', 'A'], queryFn: fetch });
  expect(reopened).toEqual({ note, markdown: 'latest durable edit' });
  expect(fetch).not.toHaveBeenCalled();
});
it('failed writes never advertise unsaved content through the loader cache', async () => {
  const client = new QueryClient();
  client.setQueryData(['note', 'A'], { note, markdown: 'durable' });
  vi.mocked(invoke).mockRejectedValue(new Error('disk unavailable'));
  await expect(persistNote(client, 'A', 'unsaved')).rejects.toThrow('disk unavailable');
  expect(client.getQueryData(['note', 'A'])).toEqual({ note, markdown: 'durable' });
});
