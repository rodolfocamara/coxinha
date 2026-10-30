import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BoardFields } from './BoardFields';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
it('keeps empty and out-of-range values as invalid drafts without moving or resizing cards', () => {
  const patch = vi.fn();
  render(
    <BoardFields
      item={{
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
      }}
      layer={vi.fn()}
      patch={patch}
      open={() => {}}
      remove={() => {}}
      canOpen={false}
    />
  );
  expect(screen.getByText('geometry').closest('details')).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('geometry', { selector: 'summary' }));
  const x = screen.getByRole('spinbutton', { name: 'x' });
  fireEvent.change(x, { target: { value: '' } });
  expect(x).toHaveAttribute('aria-invalid', 'true');
  expect(patch).not.toHaveBeenCalled();
  fireEvent.change(x, { target: { value: '1000001' } });
  expect(patch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('spinbutton', { name: 'width' }), { target: { value: '99' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'height' }), { target: { value: '59' } });
  expect(patch).not.toHaveBeenCalled();
  fireEvent.change(x, { target: { value: '-40' } });
  expect(patch).toHaveBeenCalledWith({ x: -40 });
  expect(screen.getByRole('textbox', { name: 'label' })).toHaveAttribute('maxlength', '1000');
});
