import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { NoteRecovery } from './NoteRecovery';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
it('keeps retained Markdown selectable when clipboard access fails', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard unavailable')) },
  });
  render(<NoteRecovery snapshot={{ kind: 'markdown', markdown: '# retained' }} retry={vi.fn()} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'noteRecovery.copy' }));
  });
  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
  expect(textarea).toHaveValue('# retained');
  expect(textarea.selectionStart).toBe(0);
  expect(textarea.selectionEnd).toBe('# retained'.length);
  expect(screen.getByRole('status')).toHaveTextContent('noteRecovery.manualCopy');
});
it('does not claim recoverable text when conversion produced no snapshot', () => {
  render(<NoteRecovery snapshot={{ kind: 'unavailable' }} retry={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('noteRecovery.unavailable');
  expect(screen.queryByRole('textbox')).toBeNull();
});
