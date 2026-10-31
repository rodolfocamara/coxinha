// Workspace fixtures (spec 0096 P5): per-note Markdown matching the prototype
// board, and note creation/updates that keep titles in sync so the checklist
// -> activity flow and the "Fora do quadro" drawer behave like the app.
(() => {
  const f = (window.__cxFixtures = window.__cxFixtures || {});
  const notes = f.list_notes();
  const bodies = {
    'n-api':
      '# Contrato de API v2\n\nRevisar com a Rita na 1:1.\n\n## Checklist\n\n- [x] Validar escopo com a Rita\n- [ ] Revisão de segurança na quinta\n- [ ] Publicar contrato no portal\n',
    'n-integ': '# Levantar integrações\n\nMapear webhooks e filas usadas hoje.\n',
    'n-rollback': '# Plano de rollback\n\nRascunho no runbook.\n',
    'n-comm': '# Comunicar áreas\n\nDepois do contrato fechado.\n',
    'n-idea':
      '# Resumo semanal automático\n\nUsar a transcrição do Comitê para gerar o resumo de sexta.\n\n- [ ] Pedir exemplo de resumo ao Marcos\n',
    'n-gw': '# Gateway: alerta de fila\n\nFaltou alerta quando a fila de leads parou na sexta.\n',
    'n-lgpd': '# Revisar retenção de áudio\n\nPolítica aprovada.\n',
    'n-rita':
      '# 1:1 com a Rita\n\nContrato da API v2 e alerta da fila.\n\n- [ ] Mandar o rascunho do contrato\n',
    'n-quick': '# Ideia rápida\n\nCriada pelo atalho Ctrl+Alt+Y.\n',
  };
  const titleOf = (md) => (md.match(/^#\s+(.+)$/m) || [, ''])[1].trim();
  let next = 1;
  f.list_notes = () => notes;
  f.search_notes = ({ query }) => {
    const q = String(query || '').toLowerCase();
    return notes.filter((n) => n.title.toLowerCase().includes(q) || (bodies[n.id] || '').toLowerCase().includes(q));
  };
  f.get_note = ({ id }) => {
    const n = notes.find((x) => x.id === id);
    if (!n) throw `note ${id} not found`;
    return { note: n, markdown: bodies[id] ?? '' };
  };
  f.update_note = ({ id, content }) => {
    const n = notes.find((x) => x.id === id);
    if (!n) throw `note ${id} not found`;
    bodies[id] = content;
    n.title = titleOf(content);
    n.updated_at = new Date().toISOString();
    return n;
  };
  f.create_note = () => {
    const id = `n-new-${next++}`;
    const now = new Date().toISOString();
    const n = { id, title: '', path: `${id}.md`, tags: [], created_at: now, updated_at: now };
    notes.unshift(n);
    bodies[id] = '';
    return n;
  };
  f.delete_note = ({ id }) => {
    const i = notes.findIndex((x) => x.id === id);
    if (i >= 0) notes.splice(i, 1);
    return null;
  };
  f.board_export_recovery = () => 'recovery/board-1.json';
  f.save_attachment = ({ filename }) => `attachments/${filename}`;
})();
