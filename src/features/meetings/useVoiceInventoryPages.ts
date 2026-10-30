import { useEffect, useRef, useState } from 'react';
import { voiceCurationErrorCode } from './voiceCurationError';
export type InventoryPage<T> = {
  profileGeneration: number;
  items: T[];
  nextCursor: string | null;
  scannedRows: number;
};
type View<T> = {
  scope: string;
  version: unknown;
  items: T[];
  generation: number | null;
  nextCursor: string | null;
  scannedRows: number;
  loaded: boolean;
  loading: boolean;
  stale: boolean;
  error: unknown;
  cursors: string[];
};
function empty<T>(scope: string, version: unknown): View<T> {
  return {
    scope,
    version,
    items: [],
    generation: null,
    nextCursor: null,
    scannedRows: 0,
    loaded: false,
    loading: false,
    stale: false,
    error: null,
    cursors: [],
  };
}
export function useVoiceInventoryPages<T>(
  enabled: boolean,
  scope: string,
  version: unknown,
  read: (cursor: string | null) => Promise<InventoryPage<T>>,
  id: (item: T) => string,
  binding?: { generation: number | null; onStale: () => void }
) {
  const [view, setView] = useState<View<T>>(() => empty(scope, version));
  const state = useRef(view);
  const sequence = useRef(0);
  const pending = useRef(false);
  const latest = useRef({ enabled, scope, version, read, id, binding });
  latest.current = { enabled, scope, version, read, id, binding };
  function commit(next: View<T>) {
    state.current = next;
    setView(next);
  }
  function cancel() {
    ++sequence.current;
    pending.current = false;
  }
  function invalidate(error: unknown = 'voice_curation_refresh_required') {
    cancel();
    commit({ ...state.current, stale: true, loading: false, error });
    latest.current.binding?.onStale();
  }
  async function request(cursor: string | null, reset: boolean) {
    const context = latest.current;
    const before = state.current;
    if (
      !context.enabled ||
      pending.current ||
      (!reset &&
        (before.stale || before.scope !== context.scope || before.version !== context.version))
    )
      return;
    if (!reset && cursor !== null && before.cursors.includes(cursor)) {
      invalidate('voice_curation_cursor_invalid');
      return;
    }
    const token = ++sequence.current;
    pending.current = true;
    const base = reset ? empty<T>(context.scope, context.version) : before;
    commit({ ...base, loading: true, error: null });
    try {
      const page = await context.read(cursor);
      if (
        token !== sequence.current ||
        latest.current.scope !== context.scope ||
        latest.current.version !== context.version ||
        !latest.current.enabled
      )
        return;
      if (
        (context.binding?.generation != null &&
          context.binding.generation !== page.profileGeneration) ||
        (base.generation !== null && base.generation !== page.profileGeneration)
      ) {
        invalidate();
        return;
      }
      if (
        page.nextCursor !== null &&
        (page.nextCursor === cursor || base.cursors.includes(page.nextCursor))
      ) {
        invalidate('voice_curation_cursor_invalid');
        return;
      }
      const seen = new Set(base.items.map(context.id));
      const added = page.items.filter((item) => {
        const key = context.id(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      commit({
        ...base,
        items: [...base.items, ...added],
        generation: page.profileGeneration,
        nextCursor: page.nextCursor,
        scannedRows: base.scannedRows + page.scannedRows,
        loaded: true,
        loading: false,
        stale: false,
        error: null,
        cursors: cursor === null ? base.cursors : [...base.cursors, cursor],
      });
    } catch (error) {
      if (
        token !== sequence.current ||
        latest.current.scope !== context.scope ||
        latest.current.version !== context.version ||
        !latest.current.enabled
      )
        return;
      const code = voiceCurationErrorCode(error);
      if (code === 'voice_curation_refresh_required') {
        invalidate(error);
        return;
      }
      commit({
        ...base,
        loading: false,
        error,
        stale: code === 'voice_curation_cursor_invalid',
      });
    } finally {
      if (token === sequence.current) pending.current = false;
    }
  }
  useEffect(() => {
    const current = state.current;
    if (current.scope !== scope) {
      commit(empty(scope, version));
      if (enabled) void request(null, true);
    } else if (
      current.version !== version ||
      (binding?.generation != null &&
        current.generation != null &&
        binding.generation !== current.generation)
    ) {
      if (current.loaded) invalidate();
      else {
        commit(empty(scope, version));
        if (enabled) void request(null, true);
      }
    } else if (enabled && !current.loaded && !current.stale) {
      void request(null, true);
    } else if (!enabled && current.loading) commit({ ...current, loading: false });
    return cancel;
  }, [enabled, scope, version, binding?.generation]);
  const sameScope = view.scope === scope;
  const stale =
    sameScope &&
    (view.stale ||
      view.version !== version ||
      (binding?.generation != null &&
        view.generation != null &&
        binding.generation !== view.generation));
  const current = sameScope ? view : empty<T>(scope, version);
  return {
    ...current,
    stale,
    items: current.items,
    fresh: enabled && sameScope && current.loaded && !stale && !current.loading,
    more: current.loaded && current.nextCursor !== null,
    loadMore: () => {
      const now = state.current;
      if (now.loaded && now.nextCursor !== null) void request(now.nextCursor, false);
    },
    restart: () => {
      cancel();
      void request(null, true);
    },
    invalidate,
  };
}
