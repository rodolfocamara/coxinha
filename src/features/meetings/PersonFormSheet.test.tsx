import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { PeopleDirectory } from './PeopleDirectory';
import { library } from './library';
import { voiceCuration } from './voiceCuration';
vi.mock('./library', () => ({
  library: { available: vi.fn(), createPerson: vi.fn(), list: vi.fn() },
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../sessions/sessions', () => ({ useSessions: () => ({ data: [] }) }));
vi.mock('./voiceCuration', async (original) => ({
  ...(await original<typeof import('./voiceCuration')>()),
  voiceCuration: { profilesPage: vi.fn(), samplesPage: vi.fn(), revoke: vi.fn() },
}));
const tr = (key: string) => i18n.t(key);
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('en');
  vi.mocked(library.available).mockReturnValue(true);
  vi.mocked(library.list).mockResolvedValue([]);
  vi.mocked(voiceCuration.samplesPage).mockImplementation(async (personId) => ({
    profileGeneration: 1,
    personId,
    samples: [],
    nextCursor: null,
    scannedRows: 0,
  }));
  vi.mocked(voiceCuration.profilesPage).mockResolvedValue({
    profileGeneration: 1,
    profiles: [],
    nextCursor: null,
    scannedRows: 0,
  });
});
async function openSheet() {
  render(<PeopleDirectory />);
  const add = await screen.findByRole('button', { name: tr('people.add') });
  expect(add).toHaveAttribute('data-variant', 'primary');
  fireEvent.click(add);
  return screen.findByRole('dialog', { name: tr('peopleDirectory.form.title') });
}
it('makes Add person the primary action and opens a labelled form sheet', async () => {
  const dialog = await openSheet();
  const name = within(dialog).getByRole('textbox', { name: /Person name/ });
  const consent = within(dialog).getByRole('textbox', { name: /Source and scope of consent/ });
  expect(name).toBeRequired();
  expect(consent).toBeRequired();
  expect(consent).toHaveAccessibleDescription(expect.stringContaining('Required to create'));
  expect(
    within(dialog).getByRole('button', { name: tr('peopleDirectory.form.cancel') })
  ).toBeVisible();
  expect(
    within(dialog).getByRole('button', { name: tr('library.processing.createPerson') })
  ).toHaveAttribute('data-variant', 'primary');
});
it('explains why Create is disabled instead of disabling silently', async () => {
  const dialog = await openSheet();
  const create = within(dialog).getByRole('button', {
    name: tr('library.processing.createPerson'),
  });
  expect(create).toBeDisabled();
  expect(create).toHaveAccessibleDescription(tr('peopleDirectory.form.needName'));
  fireEvent.change(within(dialog).getByRole('textbox', { name: /Person name/ }), {
    target: { value: 'Ana' },
  });
  expect(create).toHaveAccessibleDescription(tr('peopleDirectory.form.needConsent'));
  const consent = within(dialog).getByRole('textbox', { name: /Source and scope of consent/ });
  fireEvent.change(consent, { target: { value: 'Permission\u0007' } });
  expect(consent).toHaveAttribute('aria-invalid', 'true');
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    tr('peopleDirectory.form.invalidConsent')
  );
  expect(create).toBeDisabled();
  fireEvent.change(consent, { target: { value: 'Written permission' } });
  expect(create).toBeEnabled();
  expect(create).not.toHaveAccessibleDescription();
});
it('cancels without any IPC and keeps the registry untouched', async () => {
  const dialog = await openSheet();
  fireEvent.change(within(dialog).getByRole('textbox', { name: /Person name/ }), {
    target: { value: 'Ana' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: tr('peopleDirectory.form.cancel') }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(library.createPerson).not.toHaveBeenCalled();
  expect(voiceCuration.profilesPage).toHaveBeenCalledTimes(1);
});
it('creates through the same IPC, closes the sheet and opens the new person', async () => {
  vi.mocked(library.createPerson).mockResolvedValue('ana');
  const dialog = await openSheet();
  fireEvent.change(within(dialog).getByRole('textbox', { name: /Person name/ }), {
    target: { value: ' Ana ' },
  });
  fireEvent.change(within(dialog).getByRole('textbox', { name: /Source and scope of consent/ }), {
    target: { value: ' Written permission ' },
  });
  fireEvent.submit(
    within(dialog)
      .getByRole('textbox', { name: /Person name/ })
      .closest('form')!
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(library.createPerson).toHaveBeenCalledExactlyOnceWith('Ana', 'Written permission');
  expect(await screen.findByText(tr('people.created').replace('{{name}}', 'Ana'))).toBeVisible();
  // The new person opens at once, even before their profile page is listed.
  expect(await screen.findByRole('heading', { level: 2, name: 'Ana' })).toBeVisible();
});
it('offers creation from the empty registry', async () => {
  render(<PeopleDirectory />);
  expect(await screen.findByText(tr('peopleDirectory.empty.title'))).toBeVisible();
  expect(screen.getByRole('button', { name: tr('peopleDirectory.addPerson') })).toHaveAttribute(
    'data-variant',
    'primary'
  );
});
