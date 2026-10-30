import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { Select } from './Select';

function Field() {
  const [value, setValue] = useState('');
  return (
    <>
      <Select aria-label="Period" value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">All dates</option>
        <option value="disabled" disabled>
          Unavailable
        </option>
        <option value="today">Today</option>
        <option value="__coxinha_empty_option__">Literal ID</option>
      </Select>
      <output>{value}</output>
    </>
  );
}
it('selects with keyboard, skips disabled options, restores focus and closes without changing on Escape', async () => {
  const user = userEvent.setup();
  render(<Field />);
  const trigger = screen.getByRole('combobox', { name: 'Period' });
  trigger.focus();
  await user.keyboard('{ArrowDown}');
  await screen.findByRole('listbox');
  await user.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => expect(trigger).toHaveValue('today'));
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.keyboard('{ArrowDown}{End}{Escape}');
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  expect(trigger).toHaveValue('today');
  expect(trigger).toHaveFocus();
});
it('allows an empty value and arbitrary IDs through the same themed popup', async () => {
  const user = userEvent.setup();
  render(<Field />);
  const trigger = screen.getByRole('combobox');
  await user.click(trigger);
  await user.click(screen.getByRole('option', { name: 'Literal ID' }));
  expect(trigger).toHaveValue('__coxinha_empty_option__');
  await user.click(trigger);
  await user.click(screen.getByRole('option', { name: 'All dates' }));
  expect(trigger).toHaveValue('');
});
