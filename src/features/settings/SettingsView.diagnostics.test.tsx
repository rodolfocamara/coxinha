import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import en from '../../locales/en.json';
import ptBR from '../../locales/pt-BR.json';
import { SettingsView } from './SettingsView';

const mocks = vi.hoisted(() => ({ rebuild: vi.fn(), loadNotes: vi.fn(), updateConfig: vi.fn() }));
vi.mock('../../lib/bindings', () => ({
  commands: {
    getConfig: async () => ({ status: 'ok', data: { vault_path: '/fixture', shortcuts: {} } }),
    listObsidianVaults: async () => ({ status: 'ok', data: [] }),
    updateConfig: (...args: unknown[]) => mocks.updateConfig(...args),
    rebuildFromVault: (...args: unknown[]) => mocks.rebuild(...args),
  },
}));
vi.mock('../../lib/store', () => ({
  useAppStore: <T,>(select: (value: { loadNotes: typeof mocks.loadNotes }) => T) =>
    select({ loadNotes: mocks.loadNotes }),
}));
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

it.each([
  [
    'en',
    'note_file_identity_conflict',
    'duplicate note UUID in notes/a.md and notes/b.md; index unchanged',
    'stale indexed path',
    'Rebuild note index',
  ],
  [
    'pt-BR',
    'note_file_identity_conflict',
    'duplicate note UUID in notes/a.md and notes/b.md; index unchanged',
    'caminho desatualizado no índice',
    'Reconstruir índice de notas',
  ],
  [
    'en',
    'note_file_invalid_metadata',
    'indexing notes/bad.md: invalid YAML note metadata at line 6, column 3',
    'metadata in the listed files',
    'Rebuild note index',
  ],
  [
    'pt-BR',
    'note_file_invalid_metadata',
    'indexing notes/bad.md: invalid YAML note metadata at line 6, column 3',
    'metadados dos arquivos indicados',
    'Reconstruir índice de notas',
  ],
])(
  'rebuild diagnostics give localized actionable guidance and paths in %s for %s',
  async (locale, code, detail, guidance, heading) => {
    const i18n = createInstance();
    await i18n.init({
      lng: locale,
      fallbackLng: 'en',
      resources: { en: { translation: en }, 'pt-BR': { translation: ptBR } },
    });
    mocks.rebuild.mockResolvedValue({ status: 'error', error: `${code}\n${detail}` });
    render(
      <I18nextProvider i18n={i18n}>
        <SettingsView />
      </I18nextProvider>
    );
    const button = await screen.findByRole('button', { name: i18n.t('settings.vault.rebuild') });
    expect(mocks.rebuild).not.toHaveBeenCalled();
    await userEvent.click(button);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(guidance);
    expect(alert).toHaveTextContent(detail);
    expect(alert).not.toHaveTextContent(code);
    expect(screen.getByRole('heading', { name: heading })).toHaveAttribute('id', 'rebuild-heading');
    expect(mocks.rebuild).toHaveBeenCalledTimes(1);
    expect(mocks.loadNotes).not.toHaveBeenCalled();
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  }
);

it.each(['en', 'pt-BR'])(
  'renders typed diagnostic detail as escaped text in %s',
  async (locale) => {
    const i18n = createInstance();
    await i18n.init({
      lng: locale,
      fallbackLng: 'en',
      resources: { en: { translation: en }, 'pt-BR': { translation: ptBR } },
      interpolation: { escapeValue: false },
    });
    const detail =
      'duplicate note UUID in notes/<img src=x onerror="alert(1)">.md and notes/<script>bad()</script>.md';
    mocks.rebuild.mockResolvedValue({
      status: 'error',
      error: `note_file_identity_conflict\n${detail}`,
    });
    render(
      <I18nextProvider i18n={i18n}>
        <SettingsView />
      </I18nextProvider>
    );
    await userEvent.click(
      await screen.findByRole('button', { name: i18n.t('settings.vault.rebuild') })
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(detail);
    expect(alert.querySelector('img, script')).toBeNull();
    expect(screen.getByLabelText(i18n.t('noteRecovery.diagnosticDetail')).textContent).toBe(detail);
    expect(alert).not.toHaveTextContent('note_file_identity_conflict');
    expect(mocks.loadNotes).not.toHaveBeenCalled();
  }
);

it.each(['en', 'pt-BR'])(
  'preserves unknown contextual UTF-8 cause as text in %s',
  async (locale) => {
    const i18n = createInstance();
    await i18n.init({
      lng: locale,
      fallbackLng: 'en',
      resources: { en: { translation: en }, 'pt-BR': { translation: ptBR } },
      interpolation: { escapeValue: false },
    });
    const error = 'indexing daily/2026-10-24.md: stream did not contain valid UTF-8';
    mocks.rebuild.mockResolvedValue({ status: 'error', error });
    render(
      <I18nextProvider i18n={i18n}>
        <SettingsView />
      </I18nextProvider>
    );
    await userEvent.click(
      await screen.findByRole('button', { name: i18n.t('settings.vault.rebuild') })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(error);
    expect(screen.queryByLabelText(i18n.t('noteRecovery.diagnosticDetail'))).toBeNull();
  }
);
