// Browser-only Tauri IPC mock for visual checks (spec 0096). Injected by
// shoot.mjs before the app loads. Fixtures register handlers on
// window.__cxFixtures[command] = (args, state) => value | Promise.
// Unknown commands reject and are listed in window.__cxUnmocked.
(() => {
  const state = (window.__cxState = window.__cxState || {});
  const fixtures = (window.__cxFixtures = window.__cxFixtures || {});
  const unmocked = (window.__cxUnmocked = new Set());
  const callbacks = new Map();
  let nextId = 1;
  window.isTauri = true;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    plugins: {},
    transformCallback(callback, once) {
      const id = nextId++;
      callbacks.set(id, (payload) => {
        if (once) callbacks.delete(id);
        return callback && callback(payload);
      });
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    convertFileSrc(path) {
      return path;
    },
    async invoke(cmd, args = {}) {
      if (cmd === 'plugin:event|listen') return nextId++;
      if (cmd === 'plugin:event|unlisten' || cmd === 'plugin:event|emit') return null;
      if (cmd.startsWith('plugin:window|')) {
        if (cmd.endsWith('is_maximized') || cmd.endsWith('is_fullscreen')) return false;
        return null;
      }
      if (cmd.startsWith('plugin:')) return null;
      const handler = fixtures[cmd];
      if (!handler) {
        unmocked.add(cmd);
        throw new Error(`unmocked command: ${cmd}`);
      }
      return structuredClone(await handler(args, state));
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
})();
