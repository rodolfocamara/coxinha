export interface MeetingRow {
  id: string;
  title: string;
  startsAt: string;
  durationMin: number;
  participants: string[];
  summaryMd: string;
  transcriptMd: string;
  actionItemsMd: string;
  recordingPath: string | null;
}

export const __isFixture = true;

/**
 * Fixture-only meeting dataset. Matches the MeetingRow shape
 * proposed in spec 0057 so the useMeeting hook body can be rewritten
 * to hit SQLite later without touching any consumer.
 */
export const meetingFixtures: MeetingRow[] = [
  {
    id: 'it-weekly-status',
    title: 'IT Weekly Status Meeting',
    startsAt: '2026-01-15T10:00:00-03:00',
    durationMin: 45,
    participants: ['Tiago', 'Rita Menezes', 'Ana Souza', 'Kathia'],
    summaryMd:
      'Rita detalhou a proposta de endossos para cobertura-mãe; decisão de consolidar fluxo ' +
      'de exceção em uma única tela no portal NPV. Sofia assume o follow-up com jurídico.\n\n' +
      '- **Roadmap NPV** para CRM entrar histórico e priorizar endossos automáticos\n' +
      '- **Primeira entrega em março** — Rita lidera com time de dúvidas dos corretores\n' +
      '- **Sofia prepara resumo da call anterior** — 2 pendências ainda em aberto\n' +
      '- **Release em abril** depende de validação jurídica — endosso retroativo bloqueado',
    transcriptMd:
      '**Rita:** Bom dia, pessoal. Quero alinhar a proposta que mandei ontem.\n\n' +
      '**Tiago:** Peguei. Qual é o recorte que você quer atacar primeiro?\n\n' +
      '**Rita:** Foco em endossos automáticos. As corretoras estão empurrando volume ' +
      'e a gente precisa consolidar — o fluxo atual passa por três sistemas.\n\n' +
      '**Ana:** A parte de histórico no CRM já tem protótipo. Posso trazer na semana que vem.',
    actionItemsMd:
      '- [ ] **Tiago** — alinha com jurídico sobre endosso retroativo (até 25/abr)\n' +
      '- [ ] **Rita** — envia draft de UX pro painel de endossos (até 22/abr)\n' +
      '- [ ] **Ana** — traz protótipo do histórico no CRM (próxima reunião)',
    recordingPath: null,
  },
  {
    id: 'kathia-hdi-endossos',
    title: 'Reunião Kathia — HDI endossos',
    startsAt: '2026-04-21T14:00:00-03:00',
    durationMin: 14,
    participants: ['Tiago', 'Kathia'],
    summaryMd:
      'Kathia trouxe 3 decisões rápidas sobre HDI endossos. 2 pendências atribuídas:\n\n' +
      '- Revisar cláusula de exceção (Tiago)\n' +
      '- Mapear corretoras afetadas (Kathia)',
    transcriptMd:
      '**Kathia:** Rápido — HDI fez contato sobre endossos retroativos.\n\n' +
      '**Tiago:** Me manda o escopo que eu revisto. Já sei a cláusula.',
    actionItemsMd:
      '- [ ] **Tiago** — revisar cláusula de exceção\n' +
      '- [ ] **Kathia** — mapear corretoras afetadas',
    recordingPath: null,
  },
];

function logFixtureRead(id: string) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug('[fixture] meetings.useMeeting', { id });
  }
}

export function useMeeting(meetingId: string): MeetingRow | null {
  logFixtureRead(meetingId);
  return meetingFixtures.find((m) => m.id === meetingId) ?? null;
}

export function useMeetingNotes(): Array<{ id: string; title: string }> {
  // For the fixture pass, the "AI meeting notes" rail list is just
  // the meetings themselves — when DB lands, this will become a
  // join against notes that contain at least one MeetingBlock.
  return meetingFixtures.map((m) => ({ id: m.id, title: m.title }));
}
