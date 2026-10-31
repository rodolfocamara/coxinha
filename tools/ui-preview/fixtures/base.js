// Base fixtures for the UI preview harness (spec 0096). Data mirrors the
// approved prototype: one live weekly, a planned committee, a 1:1 with a
// speaker to confirm, a daily without transcript and a failed interview.
// Areas add their own files under fixtures/; they are merged in load order.
(() => {
  const f = (window.__cxFixtures = window.__cxFixtures || {});
  const state = (window.__cxState = window.__cxState || {});
  const day = 86_400_000;
  const now = new Date();
  const at = (offsetDays, h, m = 0) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays, h, m);
    return d.toISOString().slice(0, 19) + 'Z';
  };
  const meeting = (id, title, captureState, createdAt) => ({ id, title, createdAt, captureState });
  const session = (o) => ({
    origin: 'manual',
    personal_note: null,
    note_error: null,
    transcript_status: 'none',
    processing_state: null,
    processing: null,
    recording: null,
    live: null,
    created_at: o.starts_at ?? at(-1, 9),
    ...o,
  });
  const meetings = [
    meeting('m-weekly', 'Weekly de TI', 'finished', at(0, 10)),
    meeting('m-rita', '1:1 com a Rita', 'finished', at(-3, 16)),
    meeting('m-daily', 'Daily do squad', 'finished', at(-3, 9, 30)),
    meeting('m-interview', 'Entrevista: dev backend', 'interrupted', at(-4, 15)),
  ];
  const sessions = () => [
    session({
      id: 's-weekly',
      title: 'Weekly de TI',
      starts_at: at(0, 10),
      ends_at: at(0, 10, 45),
      status: 'active',
      meeting_id: state.capture === 'idle' || !state.capture ? null : 'm-weekly',
      recording: state.capture && state.capture !== 'idle' ? { ...meetings[0], captureState: 'recording' } : null,
      live: state.capture === 'recording' || state.capture === 'paused' ? { paused: state.capture === 'paused' } : null,
    }),
    session({ id: 's-committee', title: 'Comitê de produto', starts_at: at(0, 14), ends_at: at(0, 15), status: 'planned' }),
    session({ id: 's-roadmap', title: 'Revisão de roadmap', starts_at: at(3, 9), ends_at: at(3, 10), status: 'planned' }),
    session({
      id: 's-rita',
      title: '1:1 com a Rita',
      starts_at: at(-3, 16),
      ends_at: at(-3, 16, 32),
      status: 'completed',
      meeting_id: 'm-rita',
      recording: meetings[1],
      transcript_status: 'available',
      processing_state: 'succeeded',
      personal_note: { id: 'n-rita', relative_path: 'meetings/1-1-rita.md' },
    }),
    session({
      id: 's-daily',
      title: 'Daily do squad',
      starts_at: at(-3, 9, 30),
      ends_at: at(-3, 9, 44),
      status: 'completed',
      meeting_id: 'm-daily',
      recording: meetings[2],
    }),
    session({
      id: 's-interview',
      title: 'Entrevista: dev backend',
      starts_at: at(-4, 15),
      ends_at: at(-4, 15, 51),
      status: 'completed',
      meeting_id: 'm-interview',
      recording: meetings[3],
      processing_state: 'failed',
      transcript_status: 'unavailable',
    }),
  ];
  const meter = (peak) => ({ peak, lastBlockMs: 40, error: null });
  f.library_status = () => {
    const c = state.capture || 'idle';
    if (c === 'recording' || c === 'paused')
      return { active: { meetingId: 'm-weekly', paused: c === 'paused', elapsedMs: 724_000, mic: meter(0.18), output: meter(0.32), storage: null }, error: null, processing: null };
    if (c === 'processing') return { active: null, error: null, processing: { meetingId: 'm-weekly', job: 'j1', phase: 'inference' } };
    if (c === 'error') return { active: null, error: 'capture interrupted; inspect recording details', processing: null };
    return { active: null, error: null, processing: null };
  };
  f.library_sources = () => [
    { name: 'mic', description: 'Headset USB', monitor: false, is_default: true },
    { name: 'out.monitor', description: 'Alto-falantes', monitor: true, is_default: true },
  ];
  f.library_sessions = () => sessions();
  f.library_session = ({ sessionId }) => sessions().find((s) => s.id === sessionId);
  f.library_list = () => meetings;
  f.library_pause = () => {
    state.capture = state.capture === 'paused' ? 'recording' : 'paused';
    return f.library_status();
  };
  f.library_stop = () => {
    state.capture = 'idle';
    return f.library_status();
  };
  f.library_start_session = () => {
    state.capture = 'recording';
    return f.library_status();
  };
  f.library_start = f.library_start_session;
  f.library_create_session = ({ input }) => session({ id: 's-new', ...input, meeting_id: null });
  f.call_detection_status = () => ({
    enabled: true,
    supported: true,
    unavailable: false,
    calls: state.call
      ? [{ app_name: 'Microsoft Teams', process_name: 'teams', pid: 42, is_browser: false, detected_at: at(0, 13, 58) }]
      : [],
  });
  f.set_call_detection_enabled = ({ enabled }) => ({ ...f.call_detection_status(), enabled });
  // Spec 0097: state.auto = on | stop (countdown after the bound call ended).
  const autoSettings = { enabled: !!state.auto, stopWhenCallEnds: true, micSource: null, outputSource: null };
  f.auto_record_status = () => ({
    settings: autoSettings,
    binding:
      state.auto === 'stop'
        ? { sessionId: 's-weekly', meetingId: 'm-weekly', keep: false, call: { app_name: 'Microsoft Teams', process_name: 'teams', pid: 42, is_browser: false, detected_at: at(0, 10) } }
        : null,
    stopInMs: state.auto === 'stop' ? 18_000 : null,
  });
  f.set_auto_record = ({ settings }) => {
    Object.assign(autoSettings, settings);
    return f.auto_record_status();
  };
  f.auto_record_keep = () => {
    state.auto = 'on';
    return f.auto_record_status();
  };
  f.calendar_status = () => ({
    account: 'rodolfo@example.com',
    syncedAt: at(0, 8),
    events: [
      { id: 'e1', title: 'Weekly de TI', startsAt: at(0, 10), endsAt: at(0, 10, 45), cancelled: false, allDay: false, attendees: [{ name: 'Rita Souza', email: 'rita@example.com' }, { name: 'Marcos Lima', email: 'marcos@example.com' }], organizer: { name: 'Rodolfo Camara', email: 'rodolfo@example.com' } },
      { id: 'e2', title: 'Comitê de produto', startsAt: at(0, 14), endsAt: at(0, 15), cancelled: false, allDay: false, attendees: [{ name: 'Juliana Alves', email: 'ju@example.com' }], organizer: null },
      { id: 'e3', title: 'Bloco de foco', startsAt: at(0, 16, 30), endsAt: at(0, 17, 30), cancelled: false, allDay: false, attendees: [], organizer: null },
      { id: 'e4', title: 'Revisão de roadmap', startsAt: at(3, 9), endsAt: at(3, 10), cancelled: false, allDay: false, attendees: [], organizer: null },
    ],
  });
  const note = (id, title, daysAgo, tags = []) => ({
    id,
    title,
    path: `${id}.md`,
    tags,
    created_at: new Date(now - daysAgo * day).toISOString(),
    updated_at: new Date(now - daysAgo * day).toISOString(),
  });
  const notes = [
    note('n-api', 'Contrato de API v2', 0, ['crm']),
    note('n-integ', 'Levantar integrações', 2, ['crm']),
    note('n-rollback', 'Plano de rollback', 3, ['crm']),
    note('n-comm', 'Comunicar áreas', 4),
    note('n-idea', 'Resumo semanal automático', 1),
    note('n-gw', 'Gateway: alerta de fila', 1),
    note('n-lgpd', 'Revisar retenção de áudio', 9, ['lgpd']),
    note('n-rita', '1:1 com a Rita', 3),
    note('n-quick', 'Ideia rápida', 0),
  ];
  f.list_notes = () => notes;
  f.search_notes = () => notes;
  f.get_note = ({ id }) => {
    const n = notes.find((x) => x.id === id) ?? notes[0];
    return {
      note: n,
      markdown: `# ${n.title}\n\nRevisar com a Rita na 1:1.\n\n## Checklist\n\n- [x] Validar escopo com a Rita\n- [ ] Revisão de segurança na quinta\n- [ ] Publicar contrato no portal\n`,
    };
  };
  f.update_note = ({ id }) => notes.find((x) => x.id === id) ?? notes[0];
  f.create_note = () => note('n-new', 'Nota sem título', 0);
  const card = (id, noteId, label, x, y, progress, parentId = null) => ({
    id, kind: 'card', x, y, width: 210, height: 96, color: 'neutral', label, progress, parentId, noteId, notePath: `${noteId}.md`,
  });
  f.board_load = () => ({
    version: 3,
    revision: 1,
    items: [
      { id: 'a-crm', kind: 'area', x: 20, y: 28, width: 540, height: 392, color: 'blue', label: 'Migração do CRM', parentId: null, noteId: null, notePath: null },
      { id: 'a-lgpd', kind: 'area', x: 20, y: 452, width: 420, height: 178, color: 'green', label: 'LGPD', parentId: null, noteId: null, notePath: null },
      card('c-integ', 'n-integ', 'Levantar integrações', 40, 92, 100, 'a-crm'),
      card('c-api', 'n-api', 'Contrato de API v2', 300, 180, 55, 'a-crm'),
      card('c-rollback', 'n-rollback', 'Plano de rollback', 40, 228, 20, 'a-crm'),
      card('c-comm', 'n-comm', 'Comunicar áreas', 590, 92, 0),
      { id: 't-idea', kind: 'text', x: 590, y: 250, width: 210, height: 96, color: 'neutral', label: 'Resumo semanal automático', parentId: null, noteId: 'n-idea', notePath: 'n-idea.md' },
      { id: 't-gw', kind: 'text', x: 480, y: 470, width: 210, height: 96, color: 'neutral', label: 'Gateway: alerta de fila', parentId: null, noteId: 'n-gw', notePath: 'n-gw.md' },
      card('c-lgpd', 'n-lgpd', 'Revisar retenção de áudio', 40, 520, 100, 'a-lgpd'),
    ],
    edges: [
      { id: 'e-1', source: 'c-integ', target: 'c-api' },
      { id: 'e-2', source: 'c-api', target: 'c-comm' },
    ],
  });
  f.board_save = ({ board }) => ({ ...board, revision: board.revision + 1 });
  f.get_config = () => ({
    vault_path: '/home/rodolfo/coxinha',
    locale: 'pt-BR',
    transcriber: { engine: 'none' },
    diarizer: { engine: 'none' },
    llm: { kind: 'ollama', endpoint: 'http://localhost:11434', model: 'llama3' },
    autostart: true,
    shortcuts: { new_note: 'Ctrl+Alt+Y', open_app: 'Ctrl+Alt+O', agenda: 'Ctrl+Alt+G', meetings: 'Ctrl+Alt+T', toggle_recording: 'Ctrl+Alt+W' },
  });
  f.list_obsidian_vaults = () => [];
  f.desktop_diagnostic = () => null;
  f.desktop_diagnostic_info = () => 'preview';
  f.get_backlinks = () => [];
  f.list_tags = () => [];
})();
