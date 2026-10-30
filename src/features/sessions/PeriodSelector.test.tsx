import { changeControl } from '../../test/changeControl';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import '../../lib/i18n';
import { PeriodSelector } from './PeriodSelector';

afterEach(cleanup);
it('retains the last valid period while editing empty, impossible or reversed custom dates', () => {
  const change = vi.fn();
  render(<PeriodSelector period={{ kind: 'today' }} onChange={change} label="Period" />);
  changeControl(screen.getByRole('combobox', { name: 'Period' }), {
    target: { value: 'custom' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply dates' }));
  expect(screen.getByRole('alert')).toHaveTextContent('previous period is still active');
  expect(change).not.toHaveBeenCalled();
  changeControl(screen.getByLabelText('From'), { target: { value: '2026-02-30' } });
  changeControl(screen.getByLabelText('Through (inclusive)'), {
    target: { value: '2026-03-01' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply dates' }));
  expect(change).not.toHaveBeenCalled();
  changeControl(screen.getByLabelText('From'), { target: { value: '2026-10-26' } });
  changeControl(screen.getByLabelText('Through (inclusive)'), {
    target: { value: '2026-10-25' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply dates' }));
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByLabelText('From')).toHaveAttribute('aria-invalid', 'true');
  changeControl(screen.getByLabelText('From'), { target: { value: '2026-10-24' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply dates' }));
  expect(change).toHaveBeenCalledWith({ kind: 'custom', start: '2026-10-24', end: '2026-10-25' });
});
it('supports themed selection and cancels draft edits without changing the applied period', async () => {
  const change = vi.fn();
  render(<PeriodSelector period={{ kind: 'all' }} onChange={change} label="Period" />);
  changeControl(screen.getByRole('combobox'), { target: { value: 'custom' } });
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
  screen.getByRole('button', { name: 'Cancel' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(screen.queryByLabelText('From')).toBeNull();
  expect(screen.getByRole('combobox')).toHaveValue('all');
  expect(change).not.toHaveBeenCalled();
});
