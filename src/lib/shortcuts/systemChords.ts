import { create } from 'zustand';
import { commands, type ShortcutAction, type ShortcutChange, type ShortcutReport } from '../bindings';
import { shortcutEntry, type ShortcutId } from './table';

export const SYSTEM_ACTIONS: readonly ShortcutAction[] = [
  'new_note',
  'open_app',
  'agenda',
  'meetings',
  'toggle_recording',
];

export const systemShortcutId = (action: ShortcutAction) => `system.${action}` as ShortcutId;
export const defaultChord = (action: ShortcutAction) =>
  shortcutEntry(systemShortcutId(action)).keys[0];

type State = { report: ShortcutReport | null; loaded: boolean };

export const useSystemChords = create<State>(() => ({ report: null, loaded: false }));

let request: Promise<void> | null = null;

/** The desktop's state of the system chords, read once per app run unless refreshed. */
export function loadSystemChords(refresh = false) {
  if (request && !refresh) return request;
  // No backend (a browser preview, a test): the table's defaults stand.
  request = Promise.resolve()
    .then(() => commands.shortcutStatus())
    .then((result) => {
      if (result?.status === 'ok' && result.data?.statuses)
        useSystemChords.setState({ report: result.data, loaded: true });
    })
    .catch(() => undefined);
  return request;
}

/** Test hook: forget what was read. */
export function resetSystemChords() {
  request = null;
  useSystemChords.setState({ report: null, loaded: false });
}

/** Rebinds through the desktop; a transport error comes back as a failed change. */
export async function rebindSystemChord(
  action: ShortcutAction,
  chord: string
): Promise<ShortcutChange> {
  const result = await commands.setShortcut(action, chord);
  if (result.status === 'error') {
    const report = useSystemChords.getState().report ?? { statuses: [], wayland: false };
    return { ok: false, failure: 'failed', detail: result.error, report };
  }
  useSystemChords.setState({ report: result.data.report, loaded: true });
  return result.data;
}

export function chordOf(report: ShortcutReport | null, action: ShortcutAction) {
  return report?.statuses.find((status) => status.action === action)?.chord ?? defaultChord(action);
}

/** The chord in force for an action: the config's once read, the default until then. */
export function useSystemChord(action: ShortcutAction) {
  return useSystemChords((state) => chordOf(state.report, action));
}
