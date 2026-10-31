import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCaptureStore } from '../capture/captureStore';
import { HojeRoute } from './HojeRoute';
import {
  at,
  data,
  fresh,
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

describe('Hoje greeting and lede', () => {
  it('greets by time of day without inventing a name', async () => {
    render(<HojeRoute />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Bom dia\.$/);
    cleanup();
    vi.setSystemTime(new Date(2026, 9, 30, 21, 0));
    render(<HojeRoute />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Boa noite\.$/);
  });

  it('states the date, meetings today, the next time and pending reviews', async () => {
    await renderReady();
    const lede = screen.getByTestId('hoje-lede');
    await waitFor(() =>
      expect(lede).toHaveTextContent(
        'Sexta-feira, 30 de outubro. 3 reuniões hoje, a próxima às 10:00. 2 gravações esperando revisão.'
      )
    );
    expect(within(lede).getByText('3 reuniões').tagName).toBe('B');
    expect(lede).not.toHaveTextContent('Gravando');
  });

  it('never shows live from a persisted capture state', async () => {
    data.current.sessions = [
      session({
        id: 's-weekly',
        title: 'Weekly de TI',
        starts_at: at(0, 10),
        meeting_id: 'm-weekly',
        recording: recording('recording'),
      }),
    ];
    await act(async () => render(<HojeRoute />));
    await screen.findByText('Weekly de TI');
    expect(screen.getByTestId('hoje-lede')).not.toHaveTextContent('Gravando');
    expect(screen.queryByText('gravando')).not.toBeInTheDocument();
  });

  it('says what is recording now from the capture store and marks the live row', async () => {
    data.current.sessions = [
      session({
        id: 's-weekly',
        title: 'Weekly de TI',
        starts_at: at(0, 10),
        meeting_id: 'm-weekly',
        recording: recording('recording'),
      }),
    ];
    useCaptureStore.setState({
      status: {
        active: {
          meetingId: 'm-weekly',
          paused: false,
          elapsedMs: 1,
          mic: { peak: 0, lastBlockMs: null, error: null },
          output: { peak: 0, lastBlockMs: null, error: null },
        },
        error: null,
      },
    });
    render(<HojeRoute />);
    const lede = screen.getByTestId('hoje-lede');
    await waitFor(() => expect(lede).toHaveTextContent('Gravando Weekly de TI agora.'));
    expect(within(lede).getByText('Gravando Weekly de TI').tagName).toBe('B');
    const row = (await screen.findByText('Weekly de TI', { selector: 'b' })).closest('button')!;
    expect(row).toHaveAttribute('data-live', 'true');
    expect(within(row).getByText('gravando')).toBeInTheDocument();
  });
});

describe('Hoje agenda', () => {
  it('merges Outlook and meetings in time order and opens the meeting with a title morph', async () => {
    await renderReady();
    const rows = within(panel(/Agenda de hoje/))
      .getAllByRole('button')
      .filter((b) => b.dataset.row);
    expect(rows.map((r) => r.dataset.row)).toEqual(['s:s-weekly', 's:s-committee', 'e:e-focus']);
    expect(rows[0]).toHaveTextContent('Outlook · 2 pessoas');
    expect(rows[1]).toHaveTextContent('Preparar');
    fireEvent.click(rows[0]);
    const title = within(rows[0]).getByText('Weekly de TI');
    expect(motion.nameForTransition).toHaveBeenCalledWith(title, 'm-title');
    expect(motion.prepareRouteTransition).toHaveBeenCalledWith('nav');
    expect(navigate).toHaveBeenCalledWith({
      to: '/meetings/$sessionId',
      params: { sessionId: 's-weekly' },
      viewTransition: 'vt:nav',
    });
    fireEvent.click(rows[2]);
    expect(navigate).toHaveBeenLastCalledWith({ to: '/meetings', viewTransition: 'vt:nav' });
    fireEvent.click(within(panel(/Agenda de hoje/)).getByRole('button', { name: /Ver todas/ }));
    expect(navigate).toHaveBeenLastCalledWith({ to: '/meetings', viewTransition: 'vt:nav' });
  });

  it('offers to connect Outlook when there is nothing today and no account', async () => {
    data.current = fresh();
    render(<HojeRoute />);
    const connect = await screen.findByRole('button', { name: 'Conectar Outlook' });
    fireEvent.click(connect);
    expect(navigate).toHaveBeenCalledWith({
      to: '/settings',
      hash: 'integrations-heading',
      viewTransition: 'vt:nav',
    });
  });

  it('keeps the page when meetings fail to load and retries inline', async () => {
    data.current.sessions = new Error('db locked');
    render(<HojeRoute />);
    const agenda = panel(/Agenda de hoje/);
    await within(agenda).findByText('Não deu para carregar as reuniões.');
    expect(screen.getByTestId('hoje-lede')).not.toHaveTextContent('Nenhuma reunião');
    expect(within(panel(/A revisar/)).getByRole('alert')).toBeInTheDocument();
    expect(within(panel(/Esta semana/)).getByRole('alert')).toBeInTheDocument();
    expect(await screen.findByText('Levantar integrações')).toBeInTheDocument();
    data.current.sessions = populated().sessions;
    fireEvent.click(within(agenda).getByRole('button', { name: 'Tentar de novo' }));
    expect(await within(agenda).findByText('Comitê de produto')).toBeInTheDocument();
  });

  it('shows meetings even when the Outlook cache cannot be read', async () => {
    data.current.calendar = new Error('cache corrupt');
    render(<HojeRoute />);
    const agenda = panel(/Agenda de hoje/);
    await within(agenda).findByText('Não deu para ler a agenda do Outlook.');
    expect(await within(agenda).findByText('Comitê de produto')).toBeInTheDocument();
    data.current.calendar = populated().calendar;
    fireEvent.click(within(agenda).getByRole('button', { name: 'Tentar de novo' }));
    expect(await within(agenda).findByText('Bloco de foco')).toBeInTheDocument();
  });
});
