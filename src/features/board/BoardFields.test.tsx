import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AreaFields, LayoutFields } from './BoardFields';
import type { BoardItem } from './model';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const area: BoardItem = {
  id: 'a',
  kind: 'area',
  x: 20,
  y: 30,
  width: 300,
  height: 200,
  color: 'blue',
  label: 'area',
  noteId: null,
  notePath: null,
};
it('keeps empty and out-of-range values as invalid drafts without moving or resizing cards', () => {
  const patch = vi.fn();
  const remove = vi.fn();
  render(<LayoutFields item={area} layer={vi.fn()} patch={patch} remove={remove} />);
  const summary = screen.getByText('workspace.fields.geometry', { selector: 'summary' });
  expect(summary.closest('details')).not.toHaveAttribute('open');
  fireEvent.click(summary);
  const x = screen.getByRole('spinbutton', { name: 'workspace.fields.x' });
  fireEvent.change(x, { target: { value: '' } });
  expect(x).toHaveAttribute('aria-invalid', 'true');
  expect(patch).not.toHaveBeenCalled();
  fireEvent.change(x, { target: { value: '1000001' } });
  expect(patch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('spinbutton', { name: 'workspace.fields.width' }), {
    target: { value: '99' },
  });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'workspace.fields.height' }), {
    target: { value: '59' },
  });
  expect(patch).not.toHaveBeenCalled();
  fireEvent.change(x, { target: { value: '-40' } });
  expect(patch).toHaveBeenCalledWith({ x: -40 });
  fireEvent.click(screen.getByRole('button', { name: 'workspace.fields.removeArea' }));
  expect(remove).toHaveBeenCalled();
});
it('limits the area name to 1000 characters', () => {
  render(<AreaFields item={area} patch={vi.fn()} />);
  expect(screen.getByRole('textbox', { name: 'workspace.fields.label' })).toHaveAttribute(
    'maxlength',
    '1000'
  );
});
