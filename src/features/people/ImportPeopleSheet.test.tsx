import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { calendar } from '../agenda/calendar';
import { library } from '../meetings/library';
import { voiceCuration } from '../meetings/voiceCuration';
import { ImportPeopleSheet } from './ImportPeopleSheet';

vi.mock('../agenda/calendar', () => ({ calendar: { status: vi.fn() } }));
vi.mock('../meetings/library', () => ({ library: { importPeople: vi.fn() } }));
vi.mock('../meetings/voiceCuration', () => ({ voiceCuration: { profiles: vi.fn() } }));

const event = (id: string, names: string[]) => ({
  id,
  title: id,
  startsAt: '2026-11-03T12:00:00Z',
  endsAt: '2026-11-03T13:00:00Z',
  cancelled: false,
  allDay: false,
  attendees: names.map((name) => ({ name, email: null })),
});
const run = async (action: () => Promise<unknown>) => action();
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('pt-BR');
  vi.mocked(voiceCuration.profiles).mockResolvedValue({
    profileGeneration: 1,
    profiles: [{ personId: 'p', name: 'Ana', spaces: [] }],
  } as never);
});

it('imports the checked calendar participants that are not people yet', async () => {
  vi.mocked(calendar.status).mockResolvedValue({
    account: 'me@x.com',
    syncedAt: null,
    events: [event('a', ['Ana', 'Bruno', 'Carla']), event('b', ['Carla'])],
  });
  vi.mocked(library.importPeople).mockResolvedValue({ created: 1, skipped: 0 });
  const onImported = vi.fn();
  const onOpenChange = vi.fn();
  render(<ImportPeopleSheet open onOpenChange={onOpenChange} run={run} onImported={onImported} />);
  const carla = await screen.findByRole('checkbox', { name: /Carla/ });
  expect(carla).toHaveAccessibleName(/2 reuniões/);
  expect(screen.queryByRole('checkbox', { name: /Ana/ })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: /Bruno/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Importar 1 pessoa' }));
  await waitFor(() =>
    expect(library.importPeople).toHaveBeenCalledWith(
      ['Carla'],
      'Participante de reuniões da sua agenda'
    )
  );
  expect(onImported).toHaveBeenCalledWith({ created: 1, skipped: 0 });
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('asks to connect Outlook when there is no calendar', async () => {
  vi.mocked(calendar.status).mockResolvedValue({ account: null, syncedAt: null, events: [] });
  render(<ImportPeopleSheet open onOpenChange={vi.fn()} run={run} onImported={vi.fn()} />);
  expect(await screen.findByText(i18n.t('people.import.noCalendar'))).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Importar 0/ })).toBeDisabled();
});
