import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import '../../src/index.css';
import '../../src/lib/i18n';
import { WindowChromeProvider } from '../../src/components/AppShell/WindowChrome';
import { WindowFrame } from '../../src/components/AppShell/WindowFrame';
import { CommandPalette } from '../../src/features/shell/CommandPalette';
import { NoteActionsMenu } from '../../src/features/notes/NoteActionsMenu';
import { DesktopLifecycle } from '../../src/lib/DesktopLifecycle';
import { registerSaveParticipant } from '../../src/lib/lifecycle';

type Scene = 'none' | 'palette' | 'menu' | 'portal';
type Mode = 'restored' | 'maximized' | 'fullscreen';
let mode: Mode = 'restored';
mockWindows('main');
mockIPC(
  async (command) => {
    if (command === 'plugin:window|is_maximized') return mode === 'maximized';
    if (command === 'plugin:window|is_fullscreen') return mode === 'fullscreen';
    if (command === 'plugin:window|scale_factor') return 1;
    if (command === 'desktop_flush_result') return;
    throw new Error(`Unexpected corner fixture IPC: ${command}`);
  },
  { shouldMockEvents: true }
);

function Fixture() {
  const [scene, setScene] = useState<Scene>('none');
  const [mounted, setMounted] = useState(true);
  const anchor = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let release: (() => void) | undefined;
    let stopSaving: (() => void) | undefined;
    const api = {
      setScene,
      setMounted,
      async setMode(next: Mode) {
        mode = next;
        await emit('tauri://resize', { width: innerWidth, height: innerHeight });
      },
      async showExit() {
        stopSaving = registerSaveParticipant(
          () =>
            new Promise<void>((resolve) => {
              release = resolve;
            })
        );
        await emit('desktop-flush', 'corner-fixture');
      },
      async hideExit() {
        release?.();
        stopSaving?.();
        await emit('desktop-exit-aborted');
      },
    };
    Object.assign(window, { __cornerTest: api });
    return () => {
      release?.();
      stopSaving?.();
      Reflect.deleteProperty(window, '__cornerTest');
    };
  }, []);
  return (
    <>
      <DesktopLifecycle />
      {mounted && (
        <WindowChromeProvider>
          <WindowFrame>
            <div
              data-testid="inner-container"
              style={{ overflow: 'hidden', width: 200, height: 40, marginLeft: 400, marginTop: 60 }}
            >
              <button ref={anchor}>Menu anchor</button>
              <NoteActionsMenu
                open={scene === 'menu'}
                onClose={() => setScene('none')}
                anchorRef={anchor}
                onCopyLink={() => {}}
                onCopyContents={() => {}}
                onDuplicate={() => {}}
                onMoveToTrash={() => {}}
                onUndo={() => {}}
                font="default"
                onFontChange={() => {}}
                smallText={false}
                onSmallTextChange={() => {}}
                fullWidth={false}
                onFullWidthChange={() => {}}
              />
            </div>
            <CommandPalette open={scene === 'palette'} onClose={() => setScene('none')} />
          </WindowFrame>
        </WindowChromeProvider>
      )}
      {scene === 'portal' &&
        createPortal(
          <div
            data-testid="body-portal"
            style={{ position: 'fixed', inset: 0, background: '#2164a8' }}
          />,
          document.body
        )}
    </>
  );
}
const route = createRootRoute({ component: Fixture });
const router = createRouter({
  routeTree: route,
  history: createMemoryHistory({ initialEntries: ['/'] }),
});
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
