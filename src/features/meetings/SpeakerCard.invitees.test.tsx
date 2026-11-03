import { changeControl } from '../../test/changeControl';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { SpeakerCard } from './SpeakerCard';
import { library, type ProcessingReport } from './library';
vi.mock('./library', () => ({
  library: { confirmSpeaker: vi.fn(), createPerson: vi.fn(), revokeAssignment: vi.fn() },
}));
const report: ProcessingReport = {
  job: 'job',
  segments: [],
  turns: [{ id: 'turn', track: 'output', speaker: 'speaker-2', start_ms: 1000, end_ms: 2000 }],
  corrections: {},
  warnings: [],
  assignments: [],
};
const props = {
  meetingId: 'm',
  track: 'output',
  speaker: 'speaker-2',
  report,
  curationVersion: report,
  people: [
    { id: 'p-ana', name: 'Ana Souza' },
    { id: 'p-zeca', name: 'Zeca' },
  ],
  invitees: [
    { name: 'Bruno Lima', email: 'bruno@x.com' },
    { name: ' ana  SOUZA ', email: 'ana@x.com' },
    { name: 'Bruno Lima', email: null },
  ],
  recognition: null,
  disabled: false,
  act: async (action: () => Promise<unknown>) => {
    await action();
  },
  onSeek: vi.fn(),
};
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('pt-BR');
});
const choices = () =>
  screen
    .getAllByRole('option', { hidden: true })
    .map((o) => o.textContent)
    .filter(Boolean);

it('lists invitees first and reuses the existing person of the same name', () => {
  render(<SpeakerCard {...props} />);
  fireEvent.click(screen.getByRole('combobox'));
  const invited = i18n.t('speakers.invitee');
  expect(choices()).toEqual([`Bruno Lima${invited}`, `Ana Souza${invited}`, 'Zeca']);
});

it('creates an invitee as a person and confirms the voice with the prefilled verification', async () => {
  vi.mocked(library.createPerson).mockResolvedValue('p-bruno');
  render(<SpeakerCard {...props} />);
  expect(screen.getByRole('textbox', { name: i18n.t('speakers.decisionOrigin') })).toHaveValue(
    'Ouvi o trecho e reconheci a voz'
  );
  changeControl(screen.getByRole('combobox'), { target: { value: 'invitee:0' } });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('library.processing.confirm') }));
  await waitFor(() =>
    expect(library.confirmSpeaker).toHaveBeenCalledWith(
      'job',
      'speaker-2',
      'p-bruno',
      'Ouvi o trecho e reconheci a voz',
      false,
      'output'
    )
  );
  expect(library.createPerson).toHaveBeenCalledWith(
    'Bruno Lima',
    'Convidado(a) desta reunião na agenda'
  );
});

it('confirms an invitee who is already a person without creating anyone', async () => {
  render(<SpeakerCard {...props} />);
  changeControl(screen.getByRole('combobox'), { target: { value: 'p-ana' } });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('library.processing.confirm') }));
  await waitFor(() => expect(library.confirmSpeaker).toHaveBeenCalled());
  expect(vi.mocked(library.confirmSpeaker).mock.calls[0][2]).toBe('p-ana');
  expect(library.createPerson).not.toHaveBeenCalled();
});

it('leaves the verification empty for a voice that already has a name', () => {
  const named: ProcessingReport = {
    ...report,
    assignments: [
      {
        id: 'a',
        track: 'output',
        speaker: 'speaker-2',
        person_id: 'p-zeca',
        name: 'Zeca',
        state: 'confirmed',
      },
    ],
  };
  render(<SpeakerCard {...props} report={named} />);
  expect(screen.getByRole('textbox', { name: i18n.t('speakers.decisionOrigin') })).toHaveValue('');
});

it('creates a typed name nobody has and names the voice in one step', async () => {
  vi.mocked(library.createPerson).mockResolvedValue('p-carla');
  render(<SpeakerCard {...props} />);
  const field = screen.getByRole('combobox', { name: i18n.t('speakerNaming.who') });
  fireEvent.change(field, { target: { value: '  Carla   Dias' } });
  expect(screen.getByRole('option', { name: 'Criar pessoa “Carla Dias”' })).toBeInTheDocument();
  expect(screen.getByText(i18n.t('speakerNaming.newPerson', { name: 'Carla Dias' }))).toBeVisible();
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(screen.queryByRole('option')).toBeNull();
  fireEvent.keyDown(field, { key: 'Enter' });
  await waitFor(() => expect(library.confirmSpeaker).toHaveBeenCalled());
  expect(library.createPerson).toHaveBeenCalledWith(
    'Carla Dias',
    'Nomeado(a) por você ao revisar esta reunião'
  );
  expect(vi.mocked(library.confirmSpeaker).mock.calls[0]).toEqual([
    'job',
    'speaker-2',
    'p-carla',
    'Ouvi o trecho e reconheci a voz',
    false,
    'output',
  ]);
  await waitFor(() => expect(field).toHaveValue(''));
});

it('autocompletes with the keyboard and types an existing name without creating anyone', async () => {
  render(<SpeakerCard {...props} />);
  const field = screen.getByRole('combobox', { name: i18n.t('speakerNaming.who') });
  fireEvent.change(field, { target: { value: 'ze' } });
  expect(screen.getAllByRole('option').map((o) => o.getAttribute('data-value'))).toEqual([
    'p-zeca',
    'new:ze',
  ]);
  fireEvent.keyDown(field, { key: 'ArrowDown' });
  expect(field).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0].id);
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(field).toHaveValue('Zeca');
  fireEvent.change(field, { target: { value: 'ana souza' } });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('library.processing.confirm') }));
  await waitFor(() => expect(library.confirmSpeaker).toHaveBeenCalled());
  expect(vi.mocked(library.confirmSpeaker).mock.calls[0][2]).toBe('p-ana');
  expect(library.createPerson).not.toHaveBeenCalled();
});

it('keeps the prefilled verification collapsed for a first naming', () => {
  render(<SpeakerCard {...props} />);
  const origin = screen.getByRole('textbox', { name: i18n.t('speakers.decisionOrigin') });
  expect(origin.closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText(/Como verificou: Ouvi o trecho/)).toBeInTheDocument();
});
