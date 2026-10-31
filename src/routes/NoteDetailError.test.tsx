import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { expect, it, vi } from 'vitest';
import en from '../locales/en.json';
import ptBR from '../locales/pt-BR.json';

const invalidate = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate }),
  useNavigate: () => vi.fn(),
  Link: ({ children, to, hash }: { children: ReactNode; to: string; hash?: string }) => (
    <a href={`${to}${hash ? `#${hash}` : ''}`}>{children}</a>
  ),
}));
vi.mock('../features/notes/NoteEditor', () => ({
  NoteEditor: () => null,
  NoteLoadingSkeleton: () => null,
}));
import { NoteDetailError } from './NoteDetailRoute';

it.each([
  ['en', 'note_file_missing_or_moved', 'moved or deleted'],
  ['en', 'note_file_changed_externally', 'Retrying alone'],
  ['en', 'note_file_identity_conflict', 'different note'],
  ['en', 'note_file_invalid_metadata', 'metadata is invalid'],
  ['pt-BR', 'note_file_invalid_metadata', 'metadados da nota'],
  ['pt-BR', 'note_file_missing_or_moved', 'movido ou excluído'],
  ['pt-BR', 'note_file_changed_externally', 'Tentar novamente sem resolver'],
  ['pt-BR', 'note_file_identity_conflict', 'outra nota'],
])('route load failure gives localized guidance in %s for %s', async (locale, code, expected) => {
  const i18n = createInstance();
  await i18n.init({
    lng: locale,
    fallbackLng: 'en',
    resources: { en: { translation: en }, 'pt-BR': { translation: ptBR } },
  });
  invalidate.mockClear();
  render(
    <I18nextProvider i18n={i18n}>
      <NoteDetailError error={new Error(code)} reset={vi.fn()} />
    </I18nextProvider>
  );
  expect(screen.getByRole('alert')).toHaveTextContent(expected);
  expect(screen.queryByText(code)).toBeNull();
  expect(invalidate).not.toHaveBeenCalled();
  expect(
    screen.getByRole('link', { name: i18n.t('noteRecovery.openRebuildSettings') })
  ).toHaveAttribute('href', '/settings#rebuild-heading');
});

it.each(['en', 'pt-BR'])(
  'renders recognized route diagnostic details as escaped plain text in %s',
  async (locale) => {
    const i18n = createInstance();
    await i18n.init({
      lng: locale,
      fallbackLng: 'en',
      resources: { en: { translation: en }, 'pt-BR': { translation: ptBR } },
    });
    const detail =
      'indexing notes/<img src=x onerror="bad()">.md: invalid note metadata at line 5, column 2';
    invalidate.mockClear();
    render(
      <I18nextProvider i18n={i18n}>
        <NoteDetailError
          error={new Error(`note_file_invalid_metadata\n${detail}`)}
          reset={vi.fn()}
        />
      </I18nextProvider>
    );
    expect(screen.getByLabelText(i18n.t('noteRecovery.diagnosticDetail')).textContent).toBe(detail);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.queryByText(/note_file_invalid_metadata/)).toBeNull();
    expect(
      screen.getByRole('link', { name: i18n.t('noteRecovery.openRebuildSettings') })
    ).toHaveAttribute('href', '/settings#rebuild-heading');
    expect(invalidate).not.toHaveBeenCalled();
  }
);
