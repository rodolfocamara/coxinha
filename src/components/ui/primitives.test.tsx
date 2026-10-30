import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Sheet,
  Textarea,
} from '.';

afterEach(cleanup);

it('renders buttons as non-submitting by default with variant and size hooks', () => {
  const onClick = vi.fn();
  render(
    <>
      <Button variant="primary" onClick={onClick}>
        Save
      </Button>
      <Button size="sm" disabled>
        Later
      </Button>
      <Button iconOnly aria-label="Close" icon={<svg />} />
    </>
  );
  const save = screen.getByRole('button', { name: 'Save' });
  expect(save).toHaveAttribute('type', 'button');
  expect(save).toHaveAttribute('data-variant', 'primary');
  expect(save).toHaveClass('cx-btn');
  fireEvent.click(save);
  expect(onClick).toHaveBeenCalledOnce();
  const later = screen.getByRole('button', { name: 'Later' });
  expect(later).toBeDisabled();
  expect(later).toHaveAttribute('data-variant', 'secondary');
  expect(later).toHaveAttribute('data-size', 'sm');
  expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('data-icon-only', 'true');
});

it('wires label, hint, error and required state into the control', () => {
  render(
    <Field label="Name" hint="As shown in meetings" error="Name is required" required>
      <Input value="" onChange={() => {}} />
    </Field>
  );
  const input = screen.getByLabelText('Name');
  expect(input).toBeRequired();
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAccessibleDescription('As shown in meetings Name is required');
  expect(screen.getByRole('alert')).toHaveTextContent('Name is required');
  expect(screen.getByText('Name')).toHaveAttribute('data-required', 'true');
});

it('leaves a valid field unmarked and wires textareas too', () => {
  render(
    <Field label="Notes">
      <Textarea value="" onChange={() => {}} />
    </Field>
  );
  const area = screen.getByLabelText('Notes');
  expect(area.tagName).toBe('TEXTAREA');
  expect(area).not.toHaveAttribute('aria-invalid');
  expect(area).not.toBeRequired();
});

it('labels the shared Select through its Field and can fill the row', () => {
  render(
    <Field label="Language" error="Pick one">
      <Select block value="en" onChange={() => {}}>
        <option value="en">English</option>
      </Select>
    </Field>
  );
  const trigger = screen.getByRole('combobox', { name: 'Language' });
  expect(trigger).toHaveAttribute('data-block', 'true');
  expect(trigger).toHaveAttribute('aria-invalid', 'true');
  expect(trigger).toHaveAccessibleDescription('Pick one');
});

it('announces errors assertively and other alerts politely', () => {
  render(
    <>
      <Alert tone="error">Failed</Alert>
      <Alert tone="success">Saved</Alert>
    </>
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Failed');
  expect(screen.getByRole('status')).toHaveTextContent('Saved');
});

it('renders page header, empty state and badge content', () => {
  render(
    <>
      <PageHeader title="People" description="Registry" actions={<Button>Add</Button>} />
      <EmptyState title="No people yet" description="Add the first one" />
      <Badge tone="success" dot>
        Connected
      </Badge>
    </>
  );
  expect(screen.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
  expect(screen.getByText('No people yet')).toBeVisible();
  expect(screen.getByText('Connected')).toHaveAttribute('data-tone', 'success');
});

function SheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Add person</Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="New person"
        description="Stored locally"
        closeLabel="Close panel"
        footer={<Button onClick={() => setOpen(false)}>Cancel</Button>}
      >
        <Field label="Name">
          <Input />
        </Field>
      </Sheet>
    </>
  );
}

it('styles route links as buttons while keeping link semantics', () => {
  render(
    <ButtonLink to="/agenda" variant="ghost" size="sm">
      Agenda
    </ButtonLink>
  );
  const link = screen.getByRole('link', { name: 'Agenda' });
  expect(link).toHaveAttribute('href', '/agenda');
  expect(link).toHaveClass('cx-btn');
  expect(link).toHaveAttribute('data-variant', 'ghost');
  expect(link).toHaveAttribute('data-size', 'sm');
});

it('opens the sheet as a labelled dialog, closes on Escape and returns focus', async () => {
  render(<SheetHarness />);
  const trigger = screen.getByRole('button', { name: 'Add person' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'New person' });
  expect(dialog).toHaveAccessibleDescription('Stored locally');
  expect(screen.getByRole('button', { name: 'Close panel' })).toBeVisible();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});
