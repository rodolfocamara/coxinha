// Source contracts complement mocked API tests; native acceptance remains separate.
import { expect, it } from 'vitest';
import config from '../../../src-tauri/tauri.conf.json';
import capability from '../../../src-tauri/capabilities/default.json';
import appSource from '../../../src-tauri/src/lib.rs?raw';
import exitSource from '../../../src-tauri/src/desktop.rs?raw';
import protocolSource from '../../../src-tauri/src/desktop/protocol.rs?raw';
import shutdownSource from '../../../src-tauri/src/desktop/shutdown.rs?raw';
import windowSource from '../../../src-tauri/src/window.rs?raw';
import chromeSource from './useWindowChrome.ts?raw';

it('explicitly enables undecorated resizing with a usable minimum size', () => {
  expect(
    config.app.windows.find((window: { label: string }) => window.label === 'main')
  ).toMatchObject({
    decorations: false,
    resizable: true,
    minWidth: 800,
    minHeight: 600,
  });
});

it('scopes the resize permission to the main window without adding destructive permissions', () => {
  expect(capability.windows).toEqual(['main']);
  expect(capability.permissions).toContain('core:window:allow-start-resize-dragging');
  expect(capability.permissions).not.toContain('core:window:allow-destroy');
  expect(capability.permissions).not.toContain('process:allow-exit');
});

it('keeps native close requests (including OS Alt+F4) in the durable save-and-close lifecycle', () => {
  expect(appSource).toMatch(/CloseRequested[^]*api\.prevent_close\(\);\s*desktop::request_exit/);
  const exit = exitSource;
  expect(exit).toContain('desktop-flush');
  expect(exit).not.toContain('desktop.confirm');
  expect(protocolSource).toContain('FlushReply::Saved');
  expect(shutdownSource).toContain('storage.commit_shutdown');
  expect(chromeSource).not.toMatch(/\.destroy\(|\.exit\(/);
});

it('restores the main window before attempting keyboard focus', () => {
  const helper = windowSource;
  expect(helper).toMatch(/w\.show\(\)[^]*w\.unminimize\(\)[^]*w\.set_focus\(\)/);
});
