import { CallDetectionController } from '../features/detection/CallDetectionController';
import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from '@tanstack/react-router';
import type { UnlistenFn } from '@tauri-apps/api/event';

import { useTranslation } from 'react-i18next';
import { reportFrontendError } from '../lib/lifecycle';
import { CommandPalette } from '../features/shell/CommandPalette';
import { events, type Route } from '../lib/bindings';
import { useSidePanel } from '../lib/panels';
import { mark } from '../lib/perf';
import { useAppStore } from '../lib/store';
import { followThemePreference, getThemePreference, THEME_PREF_EVENT } from '../lib/theme';

/**
 * Root layout. Every route renders inside its own AppShell (spec
 * 0057) so this component only owns global concerns: theme
 * follow-up, IPC listeners, command palette overlay, and
 * shortcut handling that spans every route.
 */
export function RootLayout() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [startupFailed, setStartupFailed] = useState(false);
  const [startupAttempt, setStartupAttempt] = useState(0);
  const loadNotes = useAppStore((s) => s.loadNotes);
  const newNote = useAppStore((s) => s.newNote);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    let cleanup = followThemePreference(getThemePreference());
    const handle = () => {
      cleanup();
      cleanup = followThemePreference(getThemePreference());
    };
    window.addEventListener(THEME_PREF_EVENT, handle);
    return () => {
      cleanup();
      window.removeEventListener(THEME_PREF_EVENT, handle);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubs: UnlistenFn[] = [];

    setStartupFailed(false);
    const failed = () => {
      if (!cancelled) setStartupFailed(true);
      reportFrontendError('frontend_error');
    };
    void loadNotes().catch(failed);

    (async () => {
      const navUnsub = await events.navigate.listen(async (e) => {
        await handleRoute(e.payload.route).catch(failed);
      });
      if (cancelled) return navUnsub();
      unsubs.push(navUnsub);
    })().catch(failed);

    async function handleRoute(route: Route) {
      switch (route) {
        case 'notes-new': {
          mark('hotkey');
          const note = await newNote();
          navigate({ to: '/notes/$noteId', params: { noteId: note.id } });
          return;
        }
        case 'home':
          navigate({ to: '/' });
          return;
        case 'agenda':
          navigate({ to: '/agenda' });
          return;
        case 'meetings':
          navigate({ to: '/meetings' });
          return;
        case 'settings':
          navigate({ to: '/settings' });
          return;
        case 'toggle-recording':
          await navigate({ to: '/meetings' });
          return;
      }
    }

    return () => {
      cancelled = true;
      unsubs.forEach((f) => f());
    };
  }, [loadNotes, navigate, newNote, startupAttempt]);

  // Ctrl+K / Ctrl+P open the command palette; Ctrl+\ toggles
  // the side panel. All gated on Ctrl/Cmd so they don't fight
  // the editor's own hotkeys.
  const toggleSidePanel = useSidePanel((s) => s.toggle);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'k' || key === 'p') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (key === '\\') {
        e.preventDefault();
        toggleSidePanel();
      }
    };
    const openPalette = () => setPaletteOpen(true);
    const openMap = () => void navigate({ to: '/' });
    window.addEventListener('coxinha:open-map', openMap);
    window.addEventListener('coxinha:open-palette', openPalette);
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('coxinha:open-palette', openPalette);
      window.removeEventListener('coxinha:open-map', openMap);
      window.removeEventListener('keydown', handler);
    };
  }, [toggleSidePanel, navigate]);

  return (
    <>
      {startupFailed && (
        <div role="alert" className="p-3 border-b">
          {t('desktopRecovery.startup')}
          <button className="ml-4" onClick={() => setStartupAttempt((n) => n + 1)}>
            {t('desktopRecovery.retry')}
          </button>
        </div>
      )}
      <CallDetectionController />
      <Outlet />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}
