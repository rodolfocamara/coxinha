import { useEffect, useRef, useSyncExternalStore } from 'react';
import { addHandler, addLayer, addScope, activeScopes, watchScopes } from './registry';
import type { ListenerShortcutId, ShortcutScope } from './table';

/** Runs `handler` for a table shortcut while mounted. Returning `false` declines the key. */
export function useShortcut(
  id: ListenerShortcutId,
  handler: (event: KeyboardEvent) => void | boolean,
  options: { enabled?: boolean } = {}
) {
  const latest = useRef({ handler, enabled: options.enabled ?? true });
  latest.current = { handler, enabled: options.enabled ?? true };
  useEffect(
    () =>
      addHandler(id, {
        run: (event) => latest.current.handler(event),
        enabled: () => latest.current.enabled,
      }),
    [id]
  );
}

/** Registers an open layer on the Escape stack; Esc closes only the top one (spec 0128 P3). */
export function useEscapeLayer(
  active: boolean,
  close: () => void,
  options: { fromFields?: boolean; modal?: boolean; scope?: string } = {}
) {
  const latest = useRef(close);
  latest.current = close;
  const { fromFields = true, modal = false, scope = 'dialog' } = options;
  useEffect(() => {
    if (!active) return;
    return addLayer({ close: () => latest.current(), fromFields, modal, scope });
  }, [active, fromFields, modal, scope]);
}

/** Marks a screen as on: the `?` sheet lists the shortcuts of the scopes that are on. */
export function useShortcutScope(scope: ShortcutScope, active = true) {
  useEffect(() => {
    if (!active) return;
    return addScope(scope);
  }, [scope, active]);
}

export function useActiveScopes() {
  return useSyncExternalStore(watchScopes, activeScopes, activeScopes);
}
