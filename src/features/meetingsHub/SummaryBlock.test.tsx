import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { SummaryBlock } from './SummaryBlock';
import { TitleLlmSettings } from '../live/TitleLlmSettings';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));

const M = 'meeting-1';
const settings = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  sshTarget: 'me@mac',
  remotePort: 8000,
  model: 'qwen',
  summaries: true,
  ...over,
});
const summary = {
  markdown: '## Resumo\nMeta fechada.\n## Ações\n- **Ana** revisa o SLA\n- Bruno <b>envia</b>',
  generatedAt: '2026-11-03T15:00:00Z',
};
function route(handlers: Record<string, (args?: Record<string, unknown>) => unknown>) {
  vi.mocked(invoke).mockImplementation(async (cmd, args) => {
    const handler = handlers[cmd];
    if (!handler) throw new Error(`unexpected ${cmd}`);
    return handler(args as Record<string, unknown>);
  });
}
beforeEach(async () => {
  vi.mocked(invoke).mockReset();
  await i18n.changeLanguage('pt-BR');
});
afterEach(cleanup);

it('shows the summary as text with its date and regenerates it', async () => {
  let current = summary;
  route({
    library_meeting_summary: () => current,
    title_llm_settings: () => settings(),
    library_summarize: () => {
      current = { markdown: '## Resumo\nNovo.', generatedAt: '2026-11-03T16:00:00Z' };
      return current;
    },
  });
  render(<SummaryBlock meetingId={M} />);
  const block = await screen.findByRole('region', { name: 'Resumo' });
  expect(within(block).getByText('Meta fechada.')).toBeVisible();
  expect(within(block).getByRole('heading', { name: 'Ações' })).toBeVisible();
  expect(within(block).getByText('Ana revisa o SLA')).toBeVisible();
  // Model output stays text: no element is created from it.
  expect(block.querySelector('b')).toBeNull();
  expect(within(block).getByText('Bruno <b>envia</b>')).toBeVisible();
  expect(within(block).getByText(/gerado/)).toBeVisible();

  fireEvent.click(within(block).getByRole('button', { name: 'Gerar de novo' }));
  expect(await within(block).findByText('Novo.')).toBeVisible();
  expect(invoke).toHaveBeenCalledWith('library_summarize', { meetingId: M });
});

it('offers to generate when summaries are on and shows progress and errors', async () => {
  let fail = true;
  let release!: () => void;
  route({
    library_meeting_summary: () => null,
    title_llm_settings: () => settings(),
    library_summarize: () =>
      new Promise((resolve, reject) => {
        release = () => (fail ? reject('ssh down') : resolve(summary));
      }),
  });
  render(<SummaryBlock meetingId={M} />);
  expect(await screen.findByText(/Ainda sem resumo/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Gerar resumo' }));
  expect(await screen.findByRole('button', { name: 'Gerando…' })).toBeDisabled();
  release();
  expect(await screen.findByText('O resumo não funcionou: ssh down')).toBeVisible();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Gerar resumo' }));
  await waitFor(() => release());
  expect(await screen.findByText('Meta fechada.')).toBeVisible();
});

it('explains the setting when summaries are off and offers no button', async () => {
  route({
    library_meeting_summary: () => null,
    title_llm_settings: () => settings({ summaries: false }),
  });
  render(<SummaryBlock meetingId={M} />);
  expect(await screen.findByText(/Gerar resumos" em Ajustes/)).toBeVisible();
  expect(screen.queryByRole('button')).toBeNull();
});

it('keeps summaries off until the title model is on and saves the toggle', async () => {
  const saved: unknown[] = [];
  let current = settings({ enabled: false, summaries: false });
  route({
    title_llm_settings: () => current,
    set_title_llm_settings: (args) => {
      current = args!.settings as typeof current;
      saved.push(current);
      return current;
    },
  });
  const { unmount } = render(<TitleLlmSettings />);
  const toggle = await screen.findByRole('checkbox', { name: 'Gerar resumos' });
  expect(toggle).toBeDisabled();
  expect(screen.getByText(/envia o texto inteiro da transcrição/)).toBeVisible();
  unmount();

  current = settings({ summaries: false });
  render(<TitleLlmSettings />);
  const enabled = await screen.findByRole('checkbox', { name: 'Gerar resumos' });
  expect(enabled).not.toBeDisabled();
  fireEvent.click(enabled);
  await waitFor(() => expect(saved).toEqual([settings({ summaries: true })]));
});
