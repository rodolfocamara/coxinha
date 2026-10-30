import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NoteContent } from '../../lib/bindings';
import {
  deleteAfterPendingSaves,
  noteSaveQueue,
  readRetainedNoteSnapshot,
} from '../../lib/noteSessions';
import { NoteRecovery } from './NoteRecovery';
import { useNoteRecovery } from './useNoteRecovery';
import { SettingsView } from '../settings/SettingsView';
import en from '../../locales/en.json';
import ptBR from '../../locales/pt-BR.json';

const mocks = vi.hoisted(() => ({ rebuild: vi.fn(), updateConfig: vi.fn(), loadNotes: vi.fn() }));
vi.mock('../../lib/bindings', () => ({
  commands: {
    getConfig: async () => ({ status: 'ok', data: { vault_path: '/fixture', shortcuts: {} } }),
    listObsidianVaults: async () => ({ status: 'ok', data: [] }),
    updateConfig: (...args: unknown[]) => mocks.updateConfig(...args),
    rebuildFromVault: (...args: unknown[]) => mocks.rebuild(...args),
  },
}));
vi.mock('../../lib/store', () => ({
  useAppStore: <T,>(select: (value: { loadNotes: typeof mocks.loadNotes }) => T) =>
    select({ loadNotes: mocks.loadNotes }),
}));

const scrollIntoView = vi.fn();
const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  if (originalScrollIntoView)
    Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

it.each(['en', 'pt-BR'])(
  'navigates to the existing Settings rebuild section and back with retained text in %s',
  async (locale) => {
    const id = `navigation-${locale}`;
    const markdown = '---\r\n# Exact retained conflict text\r\n';
    const diagnostic = 'indexing notes/external.md: indexed body differs';
    const failure = `note_file_changed_externally\n${diagnostic}`;
    const save = vi.fn().mockRejectedValue(failure);
    const queue = noteSaveQueue(id, save);
    queue.change(Promise.resolve(markdown));
    await expect(queue.flush()).rejects.toBe(failure);
    const client = new QueryClient();
    const content = { markdown: '# Older body', note: { id } } as NoteContent;
    const i18n = createInstance();
    await i18n.init({
      lng: locale,
      fallbackLng: 'en',
      resources: { en: { translation: en }, 'pt-BR': { translation: ptBR } },
    });
    for (const mock of Object.values(mocks)) mock.mockClear();

    function ConflictNote() {
      const recovery = useNoteRecovery(id, content, client);
      return recovery.recovery ? (
        <NoteRecovery
          snapshot={recovery.recovery.snapshot}
          error={recovery.recovery.error}
          retry={recovery.retry}
        />
      ) : null;
    }
    const root = createRootRoute({ component: Outlet });
    const note = createRoute({
      getParentRoute: () => root,
      path: '/notes/$noteId',
      component: ConflictNote,
    });
    const settings = createRoute({
      getParentRoute: () => root,
      path: '/settings',
      component: () => (
        <>
          <SettingsView />
          <Link to="/notes/$noteId" params={{ noteId: id }}>
            return-to-note
          </Link>
        </>
      ),
    });
    const router = createRouter({
      routeTree: root.addChildren([note, settings]),
      history: createMemoryHistory({ initialEntries: [`/notes/${id}`] }),
    });
    try {
      render(
        <I18nextProvider i18n={i18n}>
          <RouterProvider router={router} />
        </I18nextProvider>
      );
      await screen.findByRole('textbox');
      expect(screen.getByLabelText(i18n.t('noteRecovery.diagnosticDetail'))).toHaveTextContent(
        diagnostic
      );
      const attempts = save.mock.calls.length;
      const link = screen.getByRole('link', { name: i18n.t('noteRecovery.openRebuildSettings') });
      expect(link).toHaveAttribute('href', '/settings#rebuild-heading');
      await userEvent.click(link);
      await screen.findByRole('heading', { name: i18n.t('settings.vault.rebuildHeading') });
      expect(router.state.location.pathname).toBe('/settings');
      expect(router.state.location.hash).toBe('rebuild-heading');
      expect(document.getElementById('rebuild-heading')).toBeInTheDocument();
      expect(mocks.rebuild).not.toHaveBeenCalled();
      expect(mocks.updateConfig).not.toHaveBeenCalled();
      expect(mocks.loadNotes).not.toHaveBeenCalled();
      expect(save).toHaveBeenCalledTimes(attempts);
      expect(await readRetainedNoteSnapshot(id)).toEqual({ kind: 'markdown', markdown });
      await userEvent.click(screen.getByRole('link', { name: 'return-to-note' }));
      await screen.findByRole('textbox');
      await waitFor(() => expect(router.state.location.pathname).toBe(`/notes/${id}`));
      expect(await readRetainedNoteSnapshot(id)).toEqual({ kind: 'markdown', markdown });
      expect(screen.getByRole('textbox')).toHaveValue(markdown.replaceAll('\r\n', '\n'));
      expect(screen.getByLabelText(i18n.t('noteRecovery.diagnosticDetail'))).toHaveTextContent(
        diagnostic
      );
      expect(mocks.rebuild).not.toHaveBeenCalled();
    } finally {
      cleanup();
      save.mockResolvedValue(undefined);
      await deleteAfterPendingSaves(id, async () => {});
      client.clear();
    }
  }
);
