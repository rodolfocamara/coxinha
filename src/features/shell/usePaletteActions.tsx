import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays,
  FileText,
  LayoutGrid,
  Mic,
  Plus,
  Settings,
  Square,
  Sun,
  SunMoon,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { commands, type ShortcutsConfig } from '../../lib/bindings';
import { applyTheme, setThemePreference } from '../../lib/theme';
import { useResolvedTheme } from '../../lib/useTheme';
import { prepareRouteTransition, setZoomOrigin } from '../../lib/motion';
import { useAppStore } from '../../lib/store';
import {
  areaForPath,
  quickCaptureTitle,
  transitionFor,
  type NavArea,
} from '../../components/Shell/NavRail';
import { toggleCapture } from '../capture/captureActions';
import { useCaptureStore } from '../capture/captureStore';

export type PaletteAction = {
  kind: 'action';
  id: string;
  label: string;
  icon: ReactNode;
  /** Only shortcuts that are really bound (global ones come from the config). */
  hint?: string;
  danger?: boolean;
  /** Keeps the palette open (confirmations that may report an error). */
  keepOpen?: boolean;
  run: () => void | Promise<unknown>;
};

const icon = (Icon: typeof Mic) => <Icon size={15} aria-hidden="true" />;

/** Global shortcuts are configurable; read them once per app run. */
let shortcutsRequest: Promise<ShortcutsConfig | null> | null = null;
function loadShortcuts() {
  shortcutsRequest ??= commands
    .getConfig()
    .then((res) => (res.status === 'ok' ? res.data.shortcuts : null))
    .catch(() => null);
  return shortcutsRequest;
}
/** Test hook: forget the cached config read. */
export function resetPaletteShortcuts() {
  shortcutsRequest = null;
}

/** Lets the next screen mount its listeners before it receives the intent. */
function afterPaint() {
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}

export function usePaletteActions({
  open,
  pathname,
  currentNote,
  onDeleteCurrent,
}: {
  open: boolean;
  pathname: string;
  currentNote: { id: string; title: string } | undefined;
  onDeleteCurrent: (note: { id: string; title: string }) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const resolvedTheme = useResolvedTheme();
  const newNote = useAppStore((s) => s.newNote);
  const live = useCaptureStore((s) => !!s.status?.active);
  const [shortcuts, setShortcuts] = useState<ShortcutsConfig | null>(null);
  const deleteCurrent = useRef(onDeleteCurrent);
  deleteCurrent.current = onDeleteCurrent;
  useEffect(() => {
    if (!open || shortcuts) return;
    let alive = true;
    void loadShortcuts().then((value) => alive && setShortcuts(value));
    return () => {
      alive = false;
    };
  }, [open, shortcuts]);

  return useMemo(() => {
    const go = (area: NavArea, to: string) => {
      const kind = transitionFor(areaForPath(pathname), area);
      if (kind === 'zoom') setZoomOrigin(document.querySelector('[data-workspace-preview]'));
      return navigate({ to, viewTransition: prepareRouteTransition(kind) });
    };
    const meetingsIntent = async (event: string) => {
      await go('meetings', '/meetings');
      await afterPaint();
      window.dispatchEvent(new Event(event));
    };
    const a = (key: string) => t(`people.palette.actions.${key}`);
    const actions: PaletteAction[] = [
      {
        kind: 'action',
        id: 'record',
        label: a(live ? 'stop' : 'record'),
        icon: icon(live ? Square : Mic),
        hint: shortcuts?.toggle_recording,
        run: () => toggleCapture(quickCaptureTitle(t('shell.record.quickTitle'))),
      },
      {
        kind: 'action',
        id: 'new-meeting',
        label: a('newMeeting'),
        icon: icon(Plus),
        run: () => meetingsIntent('coxinha:new-meeting'),
      },
      {
        kind: 'action',
        id: 'new-note',
        label: a('newNote'),
        icon: icon(FileText),
        hint: shortcuts?.new_note,
        run: async () => {
          const note = await newNote();
          await navigate({ to: '/workspace/$noteId', params: { noteId: note.id } });
        },
      },
      {
        kind: 'action',
        id: 'import-audio',
        label: a('importAudio'),
        icon: icon(Upload),
        run: () => meetingsIntent('coxinha:import-audio'),
      },
      {
        kind: 'action',
        id: 'toggle-theme',
        label: a('toggleTheme'),
        icon: icon(SunMoon),
        run: () => {
          const next = resolvedTheme === 'dark' ? 'light' : 'dark';
          setThemePreference(next);
          applyTheme(next);
        },
      },
    ];
    if (currentNote)
      actions.splice(3, 0, {
        kind: 'action',
        id: 'delete-current-note',
        label: a('deleteCurrentNote'),
        icon: icon(Trash2),
        danger: true,
        keepOpen: true,
        run: () => deleteCurrent.current(currentNote),
      });
    const dest = (id: NavArea, to: string, Icon: typeof Mic): PaletteAction => ({
      kind: 'action',
      id: `go-${id}`,
      label: t(`shell.nav.${id}`),
      icon: icon(Icon),
      run: () => go(id, to),
    });
    const destinations = [
      dest('hoje', '/', Sun),
      dest('meetings', '/meetings', CalendarDays),
      dest('workspace', '/workspace', LayoutGrid),
      dest('people', '/people', Users),
      dest('settings', '/settings', Settings),
    ];
    return { actions, destinations };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, navigate, newNote, live, shortcuts, resolvedTheme, currentNote, pathname]);
}
