import { changeControl } from '../../test/changeControl';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../../lib/i18n';
import { AgendaView } from './AgendaView';
import { calendar, emptyCalendar } from './calendar';
vi.mock('./calendar', () => ({
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
vi.mock('../meetings/library', () => ({
  library: { list: vi.fn(), participantContext: vi.fn(), setParticipantContext: vi.fn() },
}));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubEnv('VITE_OUTLOOK_CLIENT_ID', '');
  vi.stubEnv('VITE_OUTLOOK_TENANT', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});
it('opening agenda reads only local cache and never initiates authorization', async () => {
  vi.mocked(calendar.status).mockResolvedValue(emptyCalendar);
  render(<AgendaView />);
  await waitFor(() => expect(calendar.status).toHaveBeenCalledOnce());
  expect(calendar.begin).not.toHaveBeenCalled();
  expect(calendar.sync).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /Connect Outlook|Conectar Outlook/ })).toBeDisabled();
});
it('failed explicit sync retains cached occurrence and its freshness', async () => {
  vi.mocked(calendar.status).mockResolvedValue({
    account: 'subject-a',
    syncedAt: '2026-10-23T12:00:00Z',
    events: [
      {
        id: 'occurrence',
        title: 'Cached meeting',
        startsAt: '2026-10-23T13:00:00Z',
        endsAt: '2026-10-23T14:00:00Z',
        cancelled: false,
        allDay: false,
        attendees: [],
      },
    ],
  });
  vi.mocked(calendar.sync).mockRejectedValue('Offline');
  render(<AgendaView />);
  await screen.findByText('Cached meeting');
  fireEvent.click(screen.getByRole('button', { name: /Sync now|Sincronizar agora/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /Could not complete|Não foi possível concluir/
  );
  expect(screen.getByText('Cached meeting')).toBeVisible();
});

it('adds invitees only to the explicitly selected library meeting and preserves prior candidates', async () => {
  const { library } = await import('../meetings/library');
  vi.mocked(calendar.status).mockResolvedValue({
    account: 'subject',
    syncedAt: '2026-10-23T12:00:00Z',
    events: [
      {
        id: 'event',
        title: 'Meeting',
        startsAt: '2026-10-23T13:00:00Z',
        endsAt: '2026-10-23T14:00:00Z',
        cancelled: false,
        allDay: false,
        attendees: [{ name: 'Invitee', email: 'invitee@example.test' }],
      },
    ],
  });
  vi.mocked(library.list).mockResolvedValue([
    {
      id: 'chosen',
      title: 'Recorded meeting',
      createdAt: '2026-10-23T12:00:00Z',
      captureState: 'finished',
    },
  ]);
  vi.mocked(library.participantContext).mockResolvedValue([{ name: 'Invitee', email: null }]);
  vi.mocked(library.setParticipantContext).mockResolvedValue([]);
  render(<AgendaView />);
  fireEvent.click(
    await screen.findByRole('button', { name: /Review invitees|Revisar convidados/ })
  );
  expect(library.setParticipantContext).not.toHaveBeenCalled();
  const select = await screen.findByRole('combobox');
  fireEvent.keyDown(screen.getAllByRole('combobox')[0], { key: 'ArrowDown' });
  await screen.findByRole('option', { name: /Recorded meeting/ });
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  changeControl(select, { target: { value: 'chosen' } });
  fireEvent.click(screen.getByRole('button', { name: /Add candidates|Adicionar candidatos/ }));
  await waitFor(() =>
    expect(library.setParticipantContext).toHaveBeenCalledWith('chosen', [
      { name: 'Invitee', email: null },
      { name: 'Invitee', email: 'invitee@example.test' },
    ])
  );
});

it('cancels its own authorization attempt when leaving agenda', async () => {
  vi.mocked(calendar.status).mockResolvedValue(emptyCalendar);
  vi.mocked(calendar.begin).mockResolvedValue({
    id: 'attempt',
    url: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
  });
  vi.mocked(calendar.complete).mockReturnValue(new Promise(() => undefined));
  vi.mocked(calendar.cancel).mockResolvedValue();
  localStorage.setItem('outlook.clientId', 'public-client-id');
  const view = render(<AgendaView />);
  fireEvent.click(screen.getByRole('button', { name: /Connect Outlook|Conectar Outlook/ }));
  await waitFor(() => expect(calendar.complete).toHaveBeenCalledWith('attempt'));
  view.unmount();
  expect(calendar.cancel).toHaveBeenCalledWith('attempt');
});

it('keeps the cached agenda visible while offering reconnect for missing credentials', async () => {
  vi.mocked(calendar.status).mockResolvedValue({
    account: 'subject',
    syncedAt: '2026-10-23T12:00:00Z',
    events: [
      {
        id: 'event',
        title: 'Still cached',
        startsAt: '2026-10-23T13:00:00Z',
        endsAt: '2026-10-23T14:00:00Z',
        cancelled: false,
        allDay: false,
        attendees: [],
      },
    ],
  });
  vi.mocked(calendar.sync).mockRejectedValue('calendar.reconnect');
  render(<AgendaView />);
  fireEvent.click(await screen.findByRole('button', { name: /Sync now|Sincronizar agora/ }));
  expect(
    await screen.findByRole('button', { name: /Connect Outlook|Conectar Outlook/ })
  ).toBeVisible();
  expect(screen.getByText('Still cached')).toBeVisible();
  expect(calendar.disconnect).not.toHaveBeenCalled();
});

it('reports the 100 candidate limit before writing and never silently truncates invitees', async () => {
  const { library } = await import('../meetings/library');
  vi.mocked(calendar.status).mockResolvedValue({
    account: 'subject',
    syncedAt: '2026-10-23T12:00:00Z',
    events: [
      {
        id: 'event',
        title: 'Large meeting',
        startsAt: '2026-10-23T13:00:00Z',
        endsAt: '2026-10-23T14:00:00Z',
        cancelled: false,
        allDay: false,
        attendees: Array.from({ length: 101 }, (_, index) => ({
          name: `Invitee ${index}`,
          email: `${index}@example.test`,
        })),
      },
    ],
  });
  vi.mocked(library.list).mockResolvedValue([
    {
      id: 'chosen',
      title: 'Recorded meeting',
      createdAt: '2026-10-23T12:00:00Z',
      captureState: 'finished',
    },
  ]);
  vi.mocked(library.participantContext).mockResolvedValue([]);
  render(<AgendaView />);
  fireEvent.click(
    await screen.findByRole('button', { name: /Review invitees|Revisar convidados/ })
  );
  fireEvent.keyDown(screen.getAllByRole('combobox')[0], { key: 'ArrowDown' });
  await screen.findByRole('option', { name: /Recorded meeting/ });
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  changeControl(screen.getByRole('combobox'), { target: { value: 'chosen' } });
  fireEvent.click(screen.getByRole('button', { name: /Add candidates|Adicionar candidatos/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/100/);
  expect(library.setParticipantContext).not.toHaveBeenCalled();
  expect(screen.getByText('Invitee 100')).toBeVisible();
});

it('prefills the connection from build-time defaults without starting authorization', async () => {
  vi.stubEnv('VITE_OUTLOOK_CLIENT_ID', '00000000-0000-4000-8000-0000000000c1');
  vi.stubEnv('VITE_OUTLOOK_TENANT', '00000000-0000-4000-8000-0000000000a1');
  vi.mocked(calendar.status).mockResolvedValue(emptyCalendar);
  render(<AgendaView />);
  await waitFor(() => expect(calendar.status).toHaveBeenCalledOnce());
  expect(screen.getByLabelText(/Application \(client\) ID/)).toHaveValue(
    '00000000-0000-4000-8000-0000000000c1'
  );
  expect(screen.getByLabelText(/Tenant/)).toHaveValue('00000000-0000-4000-8000-0000000000a1');
  expect(screen.getByRole('button', { name: /Connect Outlook|Conectar Outlook/ })).toBeEnabled();
  expect(calendar.begin).not.toHaveBeenCalled();
});
it('keeps values the user saved over build-time defaults', async () => {
  vi.stubEnv('VITE_OUTLOOK_CLIENT_ID', '00000000-0000-4000-8000-0000000000c1');
  vi.stubEnv('VITE_OUTLOOK_TENANT', '00000000-0000-4000-8000-0000000000a1');
  localStorage.setItem('outlook.clientId', '11111111-1111-1111-1111-111111111111');
  localStorage.setItem('outlook.tenant', 'organizations');
  vi.mocked(calendar.status).mockResolvedValue(emptyCalendar);
  render(<AgendaView />);
  await waitFor(() => expect(calendar.status).toHaveBeenCalledOnce());
  expect(screen.getByLabelText(/Application \(client\) ID/)).toHaveValue(
    '11111111-1111-1111-1111-111111111111'
  );
  expect(screen.getByLabelText(/Tenant/)).toHaveValue('organizations');
});
