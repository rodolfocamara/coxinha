import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import '../../lib/i18n';
import i18n from '../../lib/i18n';
import { ChecklistActions, uncheckedTasks } from './ChecklistActions';
import type { NoteBlockEditor } from '../notes/NoteEditor';

const task = (id: string, text: string, checked = false, children: unknown[] = []) => ({
  id,
  type: 'checkListItem',
  props: { checked },
  content: [{ type: 'text', text }],
  children,
});

it('reads only unchecked, non-empty checklist lines, nested ones included', () => {
  const blocks = [
    { id: 'h', type: 'heading', content: [{ type: 'text', text: 'Checklist' }], children: [] },
    task('a', 'Validar escopo', true),
    task('b', 'Revisão de segurança', false, [task('c', 'Sub item')]),
    task('d', '   '),
  ];
  expect(uncheckedTasks(blocks as never)).toEqual([
    { id: 'b', text: 'Revisão de segurança' },
    { id: 'c', text: 'Sub item' },
  ]);
});

it('offers "→ atividade" per line and "no quadro" once the line is a card', async () => {
  await i18n.changeLanguage('pt-BR');
  let listener: (() => void) | undefined;
  const editor = {
    document: [task('a', 'Revisão de segurança'), task('b', 'Publicar contrato')],
    onChange: (cb: () => void) => {
      listener = cb;
      return () => {};
    },
  } as unknown as NoteBlockEditor;
  const onCreate = vi.fn();
  const onOpen = vi.fn();
  render(
    <div>
      <ChecklistActions
        editor={editor}
        linked={(text) => (text === 'Publicar contrato' ? 'card-9' : undefined)}
        onCreate={onCreate}
        onOpen={onOpen}
      />
    </div>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Criar atividade: Revisão de segurança' }));
  expect(onCreate).toHaveBeenCalledWith('Revisão de segurança', null);
  fireEvent.click(screen.getByRole('button', { name: 'Publicar contrato já está no quadro' }));
  expect(onOpen).toHaveBeenCalledWith('card-9');
  expect(listener).toBeTypeOf('function');
  await i18n.changeLanguage('en');
});
