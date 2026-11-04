import { matchesChord } from './chords';
import { SCOPE_ORDER, SHORTCUTS, type ShortcutEntry, type ShortcutId, type ShortcutScope } from './table';

type Handler = {
  /** `false` leaves the key unhandled: the next scope, then the browser, gets it. */
  run: (event: KeyboardEvent) => void | boolean;
  enabled: () => boolean;
};

export type Layer = {
  close: () => void;
  /** Whether Esc from a text field reaches it; a peek leaves Esc to the field. */
  fromFields: boolean;
  /** Blocks every shortcut outside `scope`. */
  modal: boolean;
  scope: string;
};

const handlers = new Map<string, Handler[]>();
const layers: Layer[] = [];
const scopes = new Map<ShortcutScope, number>();
const watchers = new Set<() => void>();
let listening = false;
let scopeSnapshot: ShortcutScope[] = [];

const listenerEntries: ShortcutEntry[] = [...SHORTCUTS]
  .filter((entry) => entry.owner === 'listener')
  .sort((a, b) => SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope));

const FIELD = 'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]';

export function isTextField(target: EventTarget | null) {
  return target instanceof Element && !!target.closest(FIELD);
}

/** The only rule for whether a key may reach a shortcut, whoever registered it. */
export function shortcutMayFire(entry: ShortcutEntry, event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.repeat && !entry.repeat) return false;
  if (isTextField(event.target) && !entry.inFields) return false;
  const modal = [...layers].reverse().find((layer) => layer.modal);
  if (!modal) return true;
  return entry.scope === modal.scope || !!entry.overDialogs?.includes(modal.scope);
}

/** Closes the top layer, and only it. Radix sheets route their Esc here too. */
export function pressEscape(event: KeyboardEvent) {
  const top = layers[layers.length - 1];
  if (!top) return;
  if (!top.fromFields && isTextField(event.target)) return;
  event.preventDefault();
  top.close();
}

function onKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return;
  if (event.key === 'Escape') {
    pressEscape(event);
    return;
  }
  for (const entry of listenerEntries) {
    if (!entry.keys.some((chord) => matchesChord(chord, event))) continue;
    if (!shortcutMayFire(entry, event)) continue;
    const handler = [...(handlers.get(entry.id) ?? [])].reverse().find((h) => h.enabled());
    if (!handler || handler.run(event) === false) continue;
    event.preventDefault();
    return;
  }
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('keydown', onKeyDown);
}

export function addHandler(id: ShortcutId, handler: Handler) {
  listen();
  const list = handlers.get(id) ?? [];
  handlers.set(id, [...list, handler]);
  return () => {
    handlers.set(
      id,
      (handlers.get(id) ?? []).filter((other) => other !== handler)
    );
  };
}

export function addLayer(layer: Layer) {
  listen();
  layers.push(layer);
  return () => {
    layers.splice(layers.indexOf(layer), 1);
  };
}

export function addScope(scope: ShortcutScope) {
  scopes.set(scope, (scopes.get(scope) ?? 0) + 1);
  publishScopes();
  return () => {
    scopes.set(scope, (scopes.get(scope) ?? 1) - 1);
    publishScopes();
  };
}

function publishScopes() {
  scopeSnapshot = [...scopes].filter(([, count]) => count > 0).map(([scope]) => scope);
  watchers.forEach((watcher) => watcher());
}

export const activeScopes = () => scopeSnapshot;

export function watchScopes(watcher: () => void) {
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
}
