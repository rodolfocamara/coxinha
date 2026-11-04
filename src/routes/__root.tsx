import { CallDetectionController } from '../features/detection/CallDetectionController';
import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { Outlet, useNavigate } from '@tanstack/react-router';
import type { UnlistenFn } from '@tauri-apps/api/event';

import { useTranslation } from 'react-i18next';
import { reportFrontendError } from '../lib/lifecycle';
import { CommandPalette } from '../features/shell/CommandPalette';
import { ShortcutNotice } from '../features/shell/ShortcutNotice';
import { ShortcutSheet } from '../features/shell/ShortcutSheet';
import { TrashUndoBar } from '../features/notes/TrashUndoBar';
import { OPEN_PALETTE_EVENT } from '../components/AppShell/SearchBar';
import { Button } from '../components/ui';
import { events, type Route } from '../lib/bindings';
import { mark } from '../lib/perf';
import { loadSystemChords, useShortcut } from '../lib/shortcuts';
import { useAppStore } from '../lib/store';
import { followThemePreference, getThemePreference, THEME_PREF_EVENT } from '../lib/theme';
import { Shell } from '../components/Shell/Shell';
import { quickCaptureTitle } from '../components/Shell/NavRail';
import { CaptureController } from '../features/capture/CaptureController';
import { toggleCapture } from '../features/capture/captureActions';

/**
 * Root layout (spec 0096): the persistent Shell (recorder strip + rail),
 * the single CaptureController, theme follow-up, IPC listeners, the command
 * palette and shortcuts that span every route.
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
          await toggleCapture(quickCaptureTitle(t('shell.record.quickTitle')));
          return;
      }
    }

    return () => {
      cancelled = true;
      unsubs.forEach((f) => f());
    };
  }, [loadNotes, navigate, newNote, startupAttempt, t]);

  useShortcut('app.palette', () => setPaletteOpen((v) => !v));
  useEffect(() => {
    void loadSystemChords();
    const openPalette = () => setPaletteOpen(true);
    const openMap = () => void navigate({ to: '/' });
    window.addEventListener('coxinha:open-map', openMap);
    window.addEventListener(OPEN_PALETTE_EVENT, openPalette);
    return () => {
      window.removeEventListener(OPEN_PALETTE_EVENT, openPalette);
      window.removeEventListener('coxinha:open-map', openMap);
    };
  }, [navigate]);

  return (
    <>
      <CaptureController />
      <CallDetectionController />
      <Shell>
        {startupFailed && (
          <div role="alert" className="flex items-center gap-3 border-b px-4 py-2 text-sm">
            {t('desktopRecovery.startup')}
            <Button
              size="sm"
              onClick={() => setStartupAttempt((n) => n + 1)}
              icon={<RotateCw size={14} aria-hidden="true" />}
            >
              {t('desktopRecovery.retry')}
            </Button>
          </div>
        )}
        <ShortcutNotice />
        <Outlet />
      </Shell>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutSheet />
      <TrashUndoBar />
    </>
  );
}
