import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { useLiveStatus, type LiveTranscript, type TitleSuggestion } from '../capture/live';
import { LiveToggle } from '../capture/recorderParts';
import { LiveTranscriptPanel } from './LiveTranscriptPanel';
import { LiveSettings } from './LiveSettings';
import { TitleLlmCard } from './TitleLlmCard';
import { TitleSuggestionNote } from './TitleSuggestionNote';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: async () => '/home/r',
  join: async (...parts: string[]) => parts.join('/'),
}));

const M = '00000000-0000-4000-8000-000000000001';
const transcript = (over: Partial<LiveTranscript> = {}): LiveTranscript => ({
  segments: [
    {
      track: 'Output',
      startFrame: 0,
      endFrame: 480000,
      startMs: 0,
      endMs: 9000,
      text: 'Bom dia, a pauta é o CRM.',
    },
    {
      track: 'Mic',
      startFrame: 0,
      endFrame: 480000,
      startMs: 4000,
      endMs: 8000,
      text: 'Vamos fechar a API.',
    },
  ],
  state: 'running',
  error: null,
  behindMs: 0,
  paused: false,
  ...over,
});
const route = (handlers: Record<string, (args: unknown) => unknown>) =>
  vi.mocked(invoke).mockImplementation(async (cmd, args) => handlers[cmd]?.(args));

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
  vi.clearAllMocks();
  useLiveStatus.setState({ snapshot: null });
});
afterEach(() => cleanup());

it('shows the provisional live transcript with speakers while recording', async () => {
  route({ library_live_transcript: () => transcript({ behindMs: 20_000 }) });
  render(<LiveTranscriptPanel meetingId={M} recording />);
  expect(await screen.findByText('Bom dia, a pauta é o CRM.')).toBeVisible();
  expect(screen.getByText('Você')).toBeVisible();
  expect(screen.getByText('Outros')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent(
    'transcrevendo · provisória · atrasada 0:20'
  );
  expect(screen.queryByRole('button', { name: 'Transcrever o resto' })).toBeNull();
});

it('offers to transcribe the rest after the recording, and keeps the old note when empty', async () => {
  route({
    library_live_transcript: () => transcript({ state: 'idle' }),
    library_live_resume: () => null,
  });
  const view = render(<LiveTranscriptPanel meetingId={M} recording={false} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Transcrever o resto' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('library_live_resume', { meetingId: M }));
  view.unmount();
  route({ library_live_transcript: () => transcript({ state: 'idle', segments: [] }) });
  render(<LiveTranscriptPanel meetingId={M} recording />);
  expect(await screen.findByRole('status')).toHaveTextContent('Gravando agora');
});

it('labels a suggested title and undoes it in one click', async () => {
  const suggestion: TitleSuggestion = {
    title: 'Migração do CRM',
    placeholder: 'Reunião no Microsoft Teams',
    sessionId: 's1',
    source: 'llm',
    model: 'qwen3.5-4b',
    endpointHost: '192.168.15.66',
    at: '2026-10-31T22:00:00Z',
    inputTokens: 300,
    stage: 'first',
    applied: true,
    dismissed: false,
  };
  route({
    library_title_suggestion: () => suggestion,
    library_dismiss_title_suggestion: () => ({ ...suggestion, applied: false, dismissed: true }),
  });
  const view = render(<TitleSuggestionNote meetingId={M} title="Migração do CRM" />);
  expect(await screen.findByText('título sugerido')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('library_dismiss_title_suggestion', { meetingId: M })
  );
  await waitFor(() => expect(screen.queryByText('título sugerido')).toBeNull());
  view.unmount();
  // A title the user typed is never labelled as suggested.
  render(<TitleSuggestionNote meetingId={M} title="Meu título" />);
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('library_title_suggestion', { meetingId: M })
  );
  expect(screen.queryByText('título sugerido')).toBeNull();
});

it('fills the Handy model path and only then allows turning live transcription on', async () => {
  route({
    live_settings: () => ({ enabled: false, modelPath: '', nThreads: 4 }),
    set_live_settings: (a) => (a as { settings: unknown }).settings,
  });
  render(<LiveSettings />);
  const toggle = await screen.findByRole('checkbox', { name: 'Transcrever durante a chamada' });
  expect(toggle).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Usar o do Handy' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('set_live_settings', {
      settings: {
        enabled: false,
        nThreads: 4,
        modelPath:
          '/home/r/.local/share/com.pais.handy/models/parakeet-v3-ptbr-tagarela-matched-q8.gguf',
      },
    })
  );
  expect(toggle).toBeEnabled();
});

it('tests the title server with a synthetic excerpt and shows the result', async () => {
  const settings = {
    enabled: false,
    sshTarget: 'macserver@192.168.15.66',
    remotePort: 8000,
    model: 'qwen3.5-4b',
  };
  route({
    title_llm_settings: () => settings,
    title_llm_test: () => 'Orçamento de infraestrutura',
  });
  render(<TitleLlmCard />);
  fireEvent.click(await screen.findByRole('button', { name: 'Testar' }));
  expect(await screen.findByText('Funcionou: Orçamento de infraestrutura')).toBeVisible();
  expect(invoke).toHaveBeenCalledWith('title_llm_test', { settings });
});

it('pauses the live transcript from the strip without touching the capture', async () => {
  useLiveStatus.setState({
    snapshot: { meeting: M, state: 'running', error: null, behindMs: 0, queued: [] },
  });
  route({ library_live_pause: () => null, library_live_status: () => null });
  render(<LiveToggle meetingId={M} />);
  fireEvent.click(screen.getByRole('button', { name: 'Pausar transcrição' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('library_live_pause', { paused: true }));
  expect(invoke).not.toHaveBeenCalledWith('library_pause', expect.anything());
});
