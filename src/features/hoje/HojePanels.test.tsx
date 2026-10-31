import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HojeRoute } from './HojeRoute';
import {
  at,
  data,
  fresh,
  fullBoard,
  motion,
  navigate,
  panel,
  populated,
  recording,
  session,
  setupHoje,
  teardownHoje,
} from './hojeTestHarness';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tanstack/react-router', async () => {
  const { navigate } = await import('./hojeTestHarness');
  return { useNavigate: () => navigate };
});
vi.mock('../../lib/motion', async () => (await import('./hojeTestHarness')).motion);
vi.mock('../board/persistence', async () => ({
  boardSession: (await import('./hojeTestHarness')).boardSession,
}));

beforeEach(setupHoje);
afterEach(teardownHoje);

async function renderReady() {
  render(<HojeRoute />);
  await screen.findByText('Comitê de produto');
  await screen.findByText('Levantar integrações');
}

describe('Hoje review and notes', () => {
  it('counts failed and missing transcriptions and opens the meeting', async () => {
    await renderReady();
    const review = panel(/A revisar/);
    const failed = within(review).getByText('transcrição falhou').closest('button')!;
    const notx = within(review).getByText('sem transcrição').closest('button')!;
    expect(failed).toHaveTextContent('1transcrição falhouEntrevista: dev backend');
    expect(notx).toHaveTextContent('1sem transcriçãoDaily do squad');
    fireEvent.click(failed);
    expect(navigate).toHaveBeenCalledWith({
      to: '/meetings/$sessionId',
      params: { sessionId: 's-interview' },
      viewTransition: 'vt:nav',
    });
  });

  it('lists recent notes and zooms into the note in the Workspace', async () => {
    await renderReady();
    const notes = panel(/Notas recentes/);
    const row = await within(notes).findByText('Contrato de API v2');
    expect(row.closest('button')).toHaveTextContent('hoje 08:12 · # crm');
    fireEvent.click(row);
    expect(motion.prepareRouteTransition).toHaveBeenLastCalledWith('zoom');
    expect(navigate).toHaveBeenLastCalledWith({
      to: '/workspace/$noteId',
      params: { noteId: 'n-api' },
      viewTransition: 'vt:zoom',
    });
  });

  it('retries notes that failed to load', async () => {
    data.current.notes = new Error('vault offline');
    render(<HojeRoute />);
    const notes = panel(/Notas recentes/);
    await within(notes).findByText('Não deu para carregar as notas.');
    data.current.notes = populated().notes;
    fireEvent.click(within(notes).getByRole('button', { name: 'Tentar de novo' }));
    expect(await within(notes).findByText('Contrato de API v2')).toBeInTheDocument();
  });
});

describe('Hoje workspace preview', () => {
  it('renders cards with the shared transition names and zooms into the board', async () => {
    await renderReady();
    const preview = document.querySelector<HTMLElement>('[data-workspace-preview]')!;
    expect(preview.style.viewTransitionName).toBe('ws-canvas');
    expect(screen.getByText('Migração do CRM 70%')).toBeInTheDocument();
    const cards = within(preview).getAllByRole('button');
    expect(cards.map((c) => c.dataset.card)).toEqual(['c-integ', 'c-api']);
    const style = cards[1].style as CSSStyleDeclaration & { viewTransitionClass?: string };
    expect(style.viewTransitionName).toBe('card-c-api');
    expect(style.viewTransitionClass).toBe('card');
    expect(cards[0].querySelector('b')).toHaveAttribute('data-done', 'true');

    fireEvent.click(cards[1]);
    expect(motion.setZoomOrigin).toHaveBeenLastCalledWith(cards[1]);
    expect(motion.prepareRouteTransition).toHaveBeenLastCalledWith('zoom');
    expect(navigate).toHaveBeenLastCalledWith({
      to: '/workspace/$noteId',
      params: { noteId: 'n-api' },
      viewTransition: 'vt:zoom',
    });
    expect(navigate).toHaveBeenCalledTimes(1);

    fireEvent.click(preview);
    expect(motion.setZoomOrigin).toHaveBeenLastCalledWith(preview);
    expect(navigate).toHaveBeenLastCalledWith({ to: '/workspace', viewTransition: 'vt:zoom' });

    fireEvent.click(within(panel(/^Workspace/)).getByRole('button', { name: /Abrir$/ }));
    expect(motion.setZoomOrigin).toHaveBeenLastCalledWith(preview);
    expect(navigate).toHaveBeenLastCalledWith({ to: '/workspace', viewTransition: 'vt:zoom' });
  });

  it('retries a board that failed to load', async () => {
    data.current.board = new Error('board unreadable');
    render(<HojeRoute />);
    const ws = panel(/^Workspace/);
    await within(ws).findByText('Não deu para carregar o quadro.');
    data.current.board = fullBoard;
    fireEvent.click(within(ws).getByRole('button', { name: 'Tentar de novo' }));
    expect(await within(ws).findByText('Contrato de API v2')).toBeInTheDocument();
  });
});

describe('Hoje week', () => {
  it('shows recorded time per weekday with today highlighted', async () => {
    data.current.sessions = [
      session({
        id: 'a',
        title: 'A',
        starts_at: at(-3, 10),
        ends_at: at(-3, 10, 45),
        recording: recording(),
        transcript_status: 'available',
      }),
      session({
        id: 'b',
        title: 'B',
        starts_at: at(0, 7),
        ends_at: at(0, 7, 30),
        recording: recording(),
        processing_state: 'failed',
      }),
    ];
    render(<HojeRoute />);
    const week = panel(/Esta semana/);
    await within(week).findByText('1h 15min gravadas');
    expect(within(week).getByText('2 reuniões · 1 transcrita · 1 falhou')).toBeInTheDocument();
    const days = within(week).getAllByRole('listitem');
    expect(days).toHaveLength(5);
    expect(days[4]).toHaveAttribute('data-today', 'true');
    expect(days[1]).toHaveAccessibleName(/45min/);
  });
});

describe('Hoje on a fresh vault', () => {
  it('shows calm empty states and no fake notes or meetings', async () => {
    data.current = fresh();
    render(<HojeRoute />);
    await screen.findByText('Tudo revisado.');
    await screen.findByText('Nenhuma nota ainda.');
    const create = await screen.findByRole('button', { name: 'Criar a primeira atividade' });
    expect(screen.getByText('Nenhuma reunião hoje.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('nada gravado')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma reunião esta semana.')).toBeInTheDocument();
    expect(
      document.querySelector('[data-row], [data-note], [data-review], [data-card]')
    ).toBeNull();
    // Names that the removed Home fixtures and the prototype used.
    for (const fake of ['Rodolfo', 'Weekly', 'Rita', 'Contrato', 'CRM', 'Comitê'])
      expect(document.body).not.toHaveTextContent(fake);
    fireEvent.click(create);
    expect(navigate).toHaveBeenCalledWith({ to: '/workspace', viewTransition: 'vt:zoom' });
  });
});
