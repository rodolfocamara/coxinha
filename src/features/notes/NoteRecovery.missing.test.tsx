import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { expect, it, vi } from 'vitest';
import en from '../../locales/en.json';
import ptBR from '../../locales/pt-BR.json';
import { NoteRecovery } from './NoteRecovery';
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, hash }: { children: ReactNode; to: string; hash?: string }) => (
    <a href={`${to}${hash ? `#${hash}` : ''}`}>{children}</a>
  ),
}));
import { isMissingNoteFile } from '../../lib/noteFileErrors';

it.each([
  ['en', 'moved or deleted'],
  ['pt-BR', 'movido ou excluído'],
])(
  'localizes the stable missing-file failure in %s and keeps exact copyable text',
  async (locale, expected) => {
    const i18n = createInstance();
    await i18n.init({
      lng: locale,
      fallbackLng: 'en',
      resources: { en: { translation: en }, 'pt-BR': { translation: ptBR } },
    });
    const markdown = '---\r\n# Retained text\r\n';
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: copy },
    });
    const retry = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <NoteRecovery
          snapshot={{ kind: 'markdown', markdown }}
          error="note_file_missing_or_moved"
          retry={retry}
        />
      </I18nextProvider>
    );
    expect(screen.getByRole('alert')).toHaveTextContent(expected);
    expect(screen.getByRole('alert')).not.toHaveTextContent('note_file_missing_or_moved');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      markdown.replaceAll('\r\n', '\n')
    );
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: i18n.t('noteRecovery.copy') }))
    );
    expect(copy).toHaveBeenCalledWith(markdown);
    expect(retry).not.toHaveBeenCalled();
    expect(
      screen.getByRole('link', { name: i18n.t('noteRecovery.openRebuildSettings') })
    ).toHaveAttribute('href', '/settings#rebuild-heading');
  }
);

it('classifies only the stable IPC code, including Error wrappers', () => {
  expect(isMissingNoteFile(new Error('note_file_missing_or_moved'))).toBe(true);
  expect(isMissingNoteFile('note_file_missing_or_moved')).toBe(true);
  for (const error of [
    'No such file or directory',
    new Error('disk full'),
    null,
    { message: 'note_file_missing_or_moved' },
  ]) {
    expect(isMissingNoteFile(error)).toBe(false);
  }
});

it.each([
  ['en', 'note_file_changed_externally', 'Retrying alone'],
  ['en', 'note_file_identity_conflict', 'Retrying alone'],
  ['en', 'note_file_invalid_metadata', 'Retrying alone'],
  ['pt-BR', 'note_file_invalid_metadata', 'Tentar novamente sem corrigir'],
  ['pt-BR', 'note_file_changed_externally', 'Tentar novamente sem resolver'],
  ['pt-BR', 'note_file_identity_conflict', 'Tentar novamente sem resolver'],
])(
  'requires explicit reconciliation for %s / %s while keeping the copy',
  async (locale, error, instruction) => {
    const i18n = createInstance();
    await i18n.init({
      lng: locale,
      fallbackLng: 'en',
      resources: { en: { translation: en }, 'pt-BR': { translation: ptBR } },
    });
    const markdown = '# Pending exact text\r\n';
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: copy },
    });
    const retry = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <NoteRecovery snapshot={{ kind: 'markdown', markdown }} error={error} retry={retry} />
      </I18nextProvider>
    );
    expect(screen.getByRole('alert')).toHaveTextContent(instruction);
    expect(screen.getByRole('alert')).not.toHaveTextContent(error);
    expect(
      screen.getByRole('button', { name: i18n.t('noteRecovery.retryAfterReconcile') })
    ).toBeInTheDocument();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: i18n.t('noteRecovery.copy') }))
    );
    expect(copy).toHaveBeenCalledWith(markdown);
    expect(retry).not.toHaveBeenCalled();
    expect(
      screen.getByRole('link', { name: i18n.t('noteRecovery.openRebuildSettings') })
    ).toHaveAttribute('href', '/settings#rebuild-heading');
  }
);
