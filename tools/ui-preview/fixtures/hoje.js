// Hoje fixtures (spec 0096 P3). The base data already covers the populated
// screen; `--state vault=empty` shows a fresh vault (no Outlook, no board,
// no notes, no meetings) and `--state hojeError=1` makes every source fail.
(() => {
  const f = (window.__cxFixtures = window.__cxFixtures || {});
  const state = window.__cxState || {};
  if (state.vault === 'empty') {
    f.library_sessions = () => [];
    f.library_list = () => [];
    f.calendar_status = () => ({ account: null, syncedAt: null, events: [] });
    f.board_load = () => ({ version: 3, revision: 0, items: [], edges: [] });
    f.list_notes = () => [];
  }
  if (state.hojeError) {
    const fail = () => Promise.reject(new Error('preview failure'));
    f.library_sessions = fail;
    f.calendar_status = fail;
    f.board_load = fail;
    f.list_notes = fail;
  }
})();
