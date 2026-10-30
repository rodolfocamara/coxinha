import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import '../../../lib/i18n';
import { useAppStore } from '../../../lib/store';
import { deleteAfterPendingSaves, waitForNotePersistence } from '../../../lib/noteSessions';
import { flushPendingSaves, setExitLocked } from '../../../lib/lifecycle';
import { CanvasNote } from './CanvasNote';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: any) => <a href="/settings">{children}</a>,
}));
let body = '',
  fail = false;
const note = {
  id: 'canvas-note',
  title: 'Plan',
  path: 'notes/plan.md',
  tags: [],
  created_at: '',
  updated_at: '',
};
beforeEach(() => {
  body = '# Plan\n\n- [ ] Next action\n\nFull paragraph visible outside editing.';
  fail = false;
  setExitLocked(false);
  useAppStore.setState({ notes: [note] });
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (cmd, args) => {
    if (cmd === 'get_note') return { note, markdown: body };
    if (cmd === 'update_note') {
      if (fail) throw 'disk full';
      body = (args as { content: string }).content;
      return note;
    }
    throw 'Unexpected command';
  });
});
afterEach(async () => {
  cleanup();
  fail = false;
  await deleteAfterPendingSaves(note.id, async () => {});
  setExitLocked(false);
});
function mount(editing = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const component = (
    <QueryClientProvider client={client}>
      <CanvasNote noteId={note.id} editing={editing} edit={vi.fn()} close={vi.fn()} />
    </QueryClientProvider>
  );
  return { ...render(component), client };
}
it('displays all content without mounting a rich editor or writing on read', async () => {
  mount();
  expect(await screen.findByText('Full paragraph visible outside editing.')).toBeVisible();
  expect(document.querySelector('[contenteditable="true"]')).toBeNull();
  expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === 'update_note')).toHaveLength(0);
});
it('checklist saves through the shared exit barrier and survives remount', async () => {
  const view = mount();
  const checkbox = await screen.findByRole('checkbox');
  fireEvent.click(checkbox);
  await act(() => flushPendingSaves());
  expect(body).toContain('- [x] Next action');
  view.unmount();
  mount();
  expect(await screen.findByRole('checkbox')).toBeChecked();
});
it('failed writes remain retained on remount and retry does not replace them with old text', async () => {
  const view = mount();
  const checkbox = await screen.findByRole('checkbox');
  fail = true;
  fireEvent.click(checkbox);
  await expect(waitForNotePersistence(note.id)).rejects.toBeTruthy();
  view.unmount();
  mount();
  const retained = await screen.findByRole('textbox');
  expect((retained as HTMLTextAreaElement).value).toContain('- [x] Next action');
  fail = false;
  await act(() => waitForNotePersistence(note.id));
  cleanup();
  mount();
  expect(await screen.findByRole('checkbox')).toBeChecked();
});
it('mounts the small editor only while active and locks it during shutdown', async () => {
  mount(true);
  await waitFor(() => expect(document.querySelector('[contenteditable="true"]')).not.toBeNull());
  expect(screen.queryByText('Duplicate')).toBeNull();
  act(() => setExitLocked(true));
  await waitFor(() => expect(document.querySelector('[contenteditable="true"]')).toBeNull());
});

it('refreshes a read-only card after the same note is saved elsewhere', async () => {
  const view = mount();
  await screen.findByText('Full paragraph visible outside editing.');
  act(() =>
    view.client.setQueryData(['note', note.id], {
      note,
      markdown: '# Updated elsewhere\n\nVisible new text.',
    })
  );
  expect(await screen.findByText('Visible new text.')).toBeVisible();
  expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === 'update_note')).toHaveLength(0);
});

it('Escape finishes editing before the canvas or ProseMirror consumes it', async () => {
  const close = vi.fn();
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <CanvasNote noteId={note.id} editing edit={vi.fn()} close={close} />
    </QueryClientProvider>
  );
  const editor = await screen.findByRole('textbox');
  fireEvent.keyDown(editor, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});
