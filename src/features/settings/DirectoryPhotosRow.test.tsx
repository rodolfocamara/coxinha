import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import { resetPersonPhotos, type DirectoryPhotoStatus } from '../people/personPhotos';
import { DirectoryPhotosRow } from './DirectoryPhotosRow';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));

const CLIENT = '00000000-0000-4000-8000-0000000000c1';
const OFF: DirectoryPhotoStatus = { enabled: false, blocked: null, stored: 0 };
let status: DirectoryPhotoStatus;
let account: string | null;

const toggle = () => screen.findByRole('checkbox', { name: 'Photos of invitees' });
const called = (command: string) =>
  vi.mocked(invoke).mock.calls.filter(([name]) => name === command);

beforeEach(async () => {
  await i18n.changeLanguage('en');
  resetPersonPhotos();
  localStorage.clear();
  localStorage.setItem('outlook.clientId', CLIENT);
  status = OFF;
  account = 'subject-a';
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'directory_photos_status') return status;
    if (command === 'calendar_status') return { account, syncedAt: null, events: [] };
    if (command === 'calendar_begin') return { id: 'attempt', url: 'https://sign-in.test' };
    if (command === 'calendar_complete') {
      status = { enabled: true, blocked: null, stored: 0 };
      return { account, syncedAt: null, events: [] };
    }
    if (command === 'directory_photos_disable') status = OFF;
    if (command === 'person_photo_index') return [];
    return null;
  });
});
afterEach(cleanup);

it('is off by default, explains itself, and asks for nothing just by opening', async () => {
  render(<DirectoryPhotosRow />);
  const box = await toggle();
  await waitFor(() => expect(box).toBeEnabled());
  expect(box).not.toBeChecked();
  expect(box).toHaveAccessibleDescription(/Microsoft 365 profile photo/);
  expect(screen.getByText(/User\.ReadBasic\.All/)).toHaveTextContent(/private folder/);
  expect(screen.getByText(/User\.ReadBasic\.All/)).toHaveTextContent(/deletes every photo/);
  expect(called('calendar_begin')).toHaveLength(0);
});

it('cannot be turned on without an Outlook connection', async () => {
  account = null;
  render(<DirectoryPhotosRow />);
  await screen.findByText(/Connect Outlook in Integrations/);
  expect(await toggle()).toBeDisabled();
});

it('turning it on by keyboard is an explicit sign-in that asks for the photos', async () => {
  const user = userEvent.setup();
  render(<DirectoryPhotosRow />);
  const box = await toggle();
  await waitFor(() => expect(box).toBeEnabled());
  box.focus();
  await user.keyboard(' ');
  await waitFor(() => expect(called('calendar_begin')).toHaveLength(1));
  expect(called('calendar_begin')[0][1]).toEqual({
    clientId: CLIENT,
    tenant: 'organizations',
    directoryPhotos: true,
  });
  await waitFor(() => expect(box).toBeChecked());
});

it('turning it off deletes the photos', async () => {
  status = { enabled: true, blocked: null, stored: 3 };
  const user = userEvent.setup();
  render(<DirectoryPhotosRow />);
  expect(await screen.findByText('On. 3 photos kept on this computer.')).toBeVisible();
  await user.click(await toggle());
  await waitFor(() => expect(called('directory_photos_disable')).toHaveLength(1));
  await waitFor(async () => expect(await toggle()).not.toBeChecked());
  expect(called('calendar_begin')).toHaveLength(0);
});

it('stays usable when disconnected, so the photos can still be deleted', async () => {
  status = { enabled: true, blocked: null, stored: 1 };
  account = null;
  render(<DirectoryPhotosRow />);
  await screen.findByRole('status');
  await waitFor(async () => expect(await toggle()).toBeEnabled());
});

it.each([
  ['calendar.photosForbidden', /refused/],
  ['calendar.photosConsent', /did not grant/],
])('shows %s and offers a new sign-in, without retrying', async (blocked, text) => {
  status = { enabled: true, blocked, stored: 0 };
  const user = userEvent.setup();
  render(<DirectoryPhotosRow />);
  expect(await screen.findByRole('alert')).toHaveTextContent(text);
  expect(called('calendar_begin')).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Sign in again' }));
  await waitFor(() => expect(called('calendar_begin')).toHaveLength(1));
  expect(called('calendar_begin')[0][1]).toMatchObject({ directoryPhotos: true });
});
