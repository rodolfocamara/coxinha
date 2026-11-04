import { render } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  RouterProvider,
} from '@tanstack/react-router';
import { vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { SettingsRoute } from '../../routes/SettingsRoute';
import { useAutoRecord } from '../capture/autoRecord';
import { settingsIndexRedirect, settingsPageRedirect } from './settingsIndex';

const config = {
  vault_path: '/fixture/vault',
  locale: '',
  transcriber: { engine: 'none' },
  diarizer: { engine: 'none' },
  llm: { kind: 'ollama', endpoint: 'http://localhost:11434', model: 'fixture' },
  autostart: false,
  shortcuts: {
    new_note: 'Ctrl+Alt+Y',
    open_app: 'Ctrl+Alt+O',
    agenda: 'Ctrl+Alt+G',
    meetings: 'Ctrl+Alt+T',
    toggle_recording: 'Ctrl+Alt+W',
  },
};

/** What every page reads on mount. Unknown commands fail, as a missing backend would. */
export function mockSettingsBackend(extra: Record<string, (args: unknown) => unknown> = {}) {
  const handlers: Record<string, (args: unknown) => unknown> = {
    get_config: () => config,
    list_obsidian_vaults: () => [],
    library_sources: () => [
      { name: 'mic-a', description: 'Fixture mic', monitor: false, is_default: true },
      { name: 'out.monitor', description: 'Fixture out', monitor: true, is_default: true },
    ],
    live_settings: () => ({ enabled: false, modelPath: '/fixture/model.gguf', nThreads: 4 }),
    title_llm_settings: () => ({
      enabled: false,
      sshTarget: 'fixture@host',
      remotePort: 8000,
      model: 'fixture',
      summaries: false,
    }),
    calendar_status: () => ({ account: null, syncedAt: null, events: [] }),
    ...extra,
  };
  useAutoRecord.setState({
    status: { settings: { enabled: false, stopWhenCallEnds: true } },
  } as never);
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    const handler = handlers[command];
    if (!handler) throw new Error(`unexpected ${command}`);
    return handler(args) as never;
  });
}

/** The real settings routes under a bare root, with a way out to leave them. */
export function renderSettingsAt(path: string) {
  const root = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <Link to="/">leave settings</Link>
      </>
    ),
  });
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <p>outside</p>,
  });
  const settings = createRoute({ getParentRoute: () => root, path: 'settings' });
  const index = createRoute({
    getParentRoute: () => settings,
    path: '/',
    beforeLoad: ({ location }) => {
      throw redirect(settingsIndexRedirect(location.hash) as never);
    },
  });
  const page = createRoute({
    getParentRoute: () => settings,
    path: '$section',
    beforeLoad: ({ params, location }) => {
      const moved = settingsPageRedirect(params.section, location.hash);
      if (moved) throw redirect(moved as never);
    },
    component: SettingsRoute,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, settings.addChildren([index, page])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router as never} />);
  return router;
}
