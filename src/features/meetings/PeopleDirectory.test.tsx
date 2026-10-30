import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import { PeopleDirectory } from './PeopleDirectory';
import { library } from './library';
import { voiceCuration } from './voiceCuration';
vi.mock('./library', () => ({ library: { available: vi.fn(), createPerson: vi.fn() } }));
vi.mock('./voiceCuration', async (original) => ({
  ...(await original<typeof import('./voiceCuration')>()),
  voiceCuration: { profilesPage: vi.fn(), samplesPage: vi.fn(), revoke: vi.fn() },
}));
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('en');
  vi.mocked(library.available).mockReturnValue(true);
  vi.mocked(voiceCuration.profilesPage).mockResolvedValue({
    profileGeneration: 1,
    profiles: [{ personId: 'ana', name: 'Ana' }],
    nextCursor: null,
    scannedRows: 1,
  });
});
it('opens global metadata without a meeting and only searches loaded people', async () => {
  render(<PeopleDirectory />);
  expect(await screen.findByText('Ana · ana')).toBeVisible();
  expect(voiceCuration.profilesPage).toHaveBeenCalledWith(null);
  expect(voiceCuration.samplesPage).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Bruno' } });
  expect(screen.queryByText('Ana · ana')).toBeNull();
  expect(screen.getByText(i18n.t('peopleDirectory.noMatch'))).toBeVisible();
  expect(voiceCuration.profilesPage).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ana' } });
  expect(screen.getByText('Ana · ana')).toBeVisible();
});
it('creates once with explicit consent, refreshes the registry and never enrolls audio', async () => {
  let finish!: (value: string) => void;
  vi.mocked(library.createPerson).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render(<PeopleDirectory />);
  await screen.findByText('Ana · ana');
  fireEvent.click(screen.getByRole('button', { name: i18n.t('peopleDirectory.addPerson') }));
  fireEvent.change(
    screen.getByLabelText(i18n.t('library.processing.personName'), { exact: false }),
    {
      target: { value: ' Bruno ' },
    }
  );
  const submit = screen.getByRole('button', { name: i18n.t('library.processing.createPerson') });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText(i18n.t('speakers.consentOrigin'), { exact: false }), {
    target: { value: ' Permission received ' },
  });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(library.createPerson).toHaveBeenCalledTimes(1);
  expect(library.createPerson).toHaveBeenCalledWith('Bruno', 'Permission received');
  await act(async () => finish('bruno'));
  expect(await screen.findByText('Bruno added to the global registry.')).toBeVisible();
  await waitFor(() => expect(voiceCuration.profilesPage).toHaveBeenCalledTimes(2));
  expect(voiceCuration.samplesPage).not.toHaveBeenCalled();
});
it('retains the form after failure and does not access private APIs in browser preview', async () => {
  vi.mocked(library.createPerson).mockRejectedValue(new Error('unavailable'));
  const view = render(<PeopleDirectory />);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('peopleDirectory.addPerson') }));
  const name = screen.getByLabelText(i18n.t('library.processing.personName'), { exact: false });
  fireEvent.change(name, { target: { value: 'Ana' } });
  fireEvent.change(screen.getByLabelText(i18n.t('speakers.consentOrigin'), { exact: false }), {
    target: { value: 'Permission received' },
  });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('library.processing.createPerson') }));
  await screen.findByRole('alert');
  expect(name).toHaveValue('Ana');
  view.unmount();
  vi.mocked(library.available).mockReturnValue(false);
  vi.mocked(voiceCuration.profilesPage).mockClear();
  render(<PeopleDirectory />);
  expect(screen.getByText(i18n.t('library.desktopRequired'))).toBeVisible();
  expect(voiceCuration.profilesPage).not.toHaveBeenCalled();
});
