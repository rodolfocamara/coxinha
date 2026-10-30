import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../lib/store';

export type ThingCardKind = 'meeting' | 'email' | 'agent-output';

export interface ThingCard {
  id: string;
  kind: ThingCardKind;
  title: string;
  subtitle: string;
  href: string;
  accent?: boolean;
}

export interface RecentItem {
  id: string;
  title: string;
  tag: string;
  updatedAtLabel: string;
  href: string;
}

export interface MessageItem {
  id: string;
  fromName: string;
  subject: string;
  excerpt: string;
  href: string;
}

export interface NewsItem {
  id: string;
  label: string;
  highlighted?: boolean;
}

export interface HomeFixture {
  userFirstName: string;
  todayIso: string;
  thingsToday: ThingCard[];
  recents: RecentItem[];
  messages: MessageItem[];
  news: NewsItem[];
}

/**
 * Fixture-only dataset that mirrors docs/ui/new-options.pen Page 26
 * (dark + light). Shape matches the DB rows proposed in spec 0057 so
 * the consumer hook can swap implementations without touching this
 * file's consumers. All text here is placeholder content; do not
 * treat anything here as real state.
 */
export const __isFixture = true;

export const homeFixture: HomeFixture = {
  userFirstName: 'Rodolfo',
  todayIso: '2026-04-22',
  thingsToday: [
    {
      id: 't1',
      kind: 'meeting',
      title: 'Reunião em 40min — IT Weekly Status',
      subtitle: 'Sofia já preparou o resumo dos pontos em aberto',
      href: '/notes',
    },
    {
      id: 't2',
      kind: 'email',
      title: 'Rita Menezes respondeu o e-mail de endossos',
      subtitle: '2 dúvidas respondidas, fluxo ainda aguardando',
      href: '/notes',
    },
    {
      id: 't3',
      kind: 'agent-output',
      title: 'Sofia terminou o resumo da call da Kathia',
      subtitle: '14 minutos, 3 decisões, 2 pendências atribuídas',
      href: '/notes',
      accent: true,
    },
  ],
  recents: [
    {
      id: 'r1',
      title: 'Rename AI',
      tag: 'agent',
      updatedAtLabel: '10/abr',
      href: '/notes',
    },
    {
      id: 'r2',
      title: 'AI Roadmap and NPV Project Planning',
      tag: 'roadmap',
      updatedAtLabel: '15/jan',
      href: '/notes',
    },
    {
      id: 'r3',
      title: 'Reunião Kathia — HDI endossos',
      tag: 'meeting',
      updatedAtLabel: 'ontem',
      href: '/notes',
    },
    {
      id: 'r4',
      title: 'Planejamento Multi-Country',
      tag: 'planning',
      updatedAtLabel: '18/abr',
      href: '/notes',
    },
  ],
  messages: [
    {
      id: 'm1',
      fromName: 'Rita Menezes',
      subject: 'Endossos — dúvidas das corretoras',
      excerpt: 'Problema: esperando de diversas das corretoras',
      href: '/notes',
    },
  ],
  news: [
    { id: 'n1', label: 'fast.com.br/sofia' },
    { id: 'n2', label: 'status.npv/assinaturas' },
    { id: 'n3', label: 'Seja bem-vindo à full-compilação', highlighted: true },
  ],
};

export function useHome(): HomeFixture {
  const { t } = useTranslation();
  const notes = useAppStore((state) => state.notes);
  const today = new Date();
  return {
    userFirstName: '',
    todayIso: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
    thingsToday: [],
    messages: [],
    news: [],
    recents: notes
      .slice()
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 8)
      .map((note) => ({
        id: note.id,
        title: note.title || t('sidebar.untitled'),
        tag: '',
        updatedAtLabel: new Date(note.updated_at).toLocaleDateString(),
        href: `/notes/${note.id}`,
      })),
  };
}
