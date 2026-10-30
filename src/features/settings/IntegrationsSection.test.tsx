import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../../lib/i18n';
import { calendar, emptyCalendar } from '../agenda/calendar';
import { IntegrationsSection } from './IntegrationsSection';

vi.mock('../agenda/calendar', () => ({
  emptyCalendar: { account: null, syncedAt: null, events: [] },
  calendar: {
    status: vi.fn(),
    begin: vi.fn(),
    complete: vi.fn(),
    cancel: vi.fn(),
    sync: vi.fn(),
    disconnect: vi.fn(),
  },
}));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubEnv('VITE_OUTLOOK_CLIENT_ID', '');
  vi.stubEnv('VITE_OUTLOOK_TENANT', '');
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

it('offers Connect for a disconnected Outlook account without starting authorization', async () => {
  vi.mocked(calendar.status).mockResolvedValue(emptyCalendar);
  localStorage.setItem('outlook.clientId', '00000000-0000-4000-8000-0000000000c1');
  render(<IntegrationsSection onOpenAgenda={vi.fn()} />);
  await waitFor(() => expect(calendar.status).toHaveBeenCalledOnce());
  const card = screen.getByRole('region', { name: /Outlook calendar|Agenda do Outlook/ });
  expect(card).toHaveTextContent(/Not connected|Não conectado/);
  expect(screen.getByRole('button', { name: /Connect Outlook|Conectar Outlook/ })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /Sync now|Sincronizar agora/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Open agenda|Abrir agenda/ })).toBeNull();
  expect(calendar.begin).not.toHaveBeenCalled();
});

it('offers Sync, Disconnect and Open agenda once connected', async () => {
  vi.mocked(calendar.status).mockResolvedValue({
    account: 'subject-a',
    syncedAt: '2026-10-29T12:00:00Z',
    events: [],
  });
  vi.mocked(calendar.sync).mockResolvedValue({
    account: 'subject-a',
    syncedAt: '2026-10-29T13:00:00Z',
    events: [],
  });
  const openAgenda = vi.fn();
  render(<IntegrationsSection onOpenAgenda={openAgenda} />);
  expect(await screen.findByText(/^(Connected|Conectado)$/)).toBeVisible();
  expect(screen.queryByRole('button', { name: /Connect Outlook|Conectar Outlook/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Open agenda|Abrir agenda/ }));
  expect(openAgenda).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: /Sync now|Sincronizar agora/ }));
  await waitFor(() => expect(calendar.sync).toHaveBeenCalledOnce());
  expect(
    screen.getByRole('button', { name: /Disconnect and remove cache|Desconectar e remover cache/ })
  ).toBeEnabled();
});

it('explains why Connect is disabled when no client ID is configured', async () => {
  vi.mocked(calendar.status).mockResolvedValue(emptyCalendar);
  render(<IntegrationsSection />);
  await waitFor(() => expect(calendar.status).toHaveBeenCalledOnce());
  expect(screen.getByRole('button', { name: /Connect Outlook|Conectar Outlook/ })).toBeDisabled();
  expect(
    screen.getByText(/Application \(client\) ID under|Application \(client\) ID nas/)
  ).toBeVisible();
});
