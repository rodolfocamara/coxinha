import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), navigate: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));

import { ItemLinks } from './ItemLinks';

const note = (id: string, title: string, path = `notes/${id}.md`) => ({
  id,
  title,
  path,
  tags: [],
  created_at: '',
  updated_at: '',
});
let links: { session: string; note: string; createdAt: string }[];

beforeEach(async () => {
  await i18n.changeLanguage('en');
  links = [];
  mocks.navigate.mockReset();
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (command: string, args: Record<string, string | null>) => {
    switch (command) {
      case 'list_notes':
        return [
          note('n-api', 'Contrato de API v2'),
          note('n-deck', 'Deck do comitê'),
          note('n-meet', 'My notes', 'notes/session-s-1.md'),
          note('n-day', '2026-11-03', 'daily/2026-11-03.md'),
        ];
      case 'library_sessions':
        return [
          { id: 's-1', title: 'Pulso MX', starts_at: '2026-11-03T16:30:00Z', created_at: '' },
          {
            id: 's-2',
            title: 'Comitê de produto',
            starts_at: null,
            created_at: '2026-10-20T10:00:00Z',
          },
        ];
      case 'links_list':
        return links.filter(
          (l) =>
            (!args.session || l.session === args.session) && (!args.note || l.note === args.note)
        );
      case 'links_add':
        links.push({ session: args.session!, note: args.note!, createdAt: 'now' });
        return null;
      case 'links_remove':
        links = links.filter((l) => !(l.session === args.session && l.note === args.note));
        return null;
      default:
        throw new Error(`unexpected ${command}`);
    }
  });
});
afterEach(cleanup);

it('links an activity to a meeting, skipping meeting and daily notes, and unlinks it', async () => {
  render(<ItemLinks side="meeting" sessionId="s-1" />);
  expect(await screen.findByText('No linked activities.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Link activity' }));
  const results = await screen.findByRole('list', { name: 'Activities found' });
  expect(
    within(results)
      .getAllByRole('button')
      .map((b) => b.textContent?.trim())
  ).toEqual(['Contrato de API v2', 'Deck do comitê']);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search activities' }), {
    target: { value: 'comite' },
  });
  fireEvent.click(within(results).getByRole('button', { name: 'Deck do comitê' }));
  const linked = await screen.findByRole('list', { name: 'Activities' });
  const chip = within(linked).getByRole('button', { name: 'Deck do comitê' });
  expect(screen.queryByRole('list', { name: 'Activities found' })).toBeNull();
  expect(links).toEqual([{ session: 's-1', note: 'n-deck', createdAt: 'now' }]);
  fireEvent.click(chip);
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: '/workspace/$noteId',
    params: { noteId: 'n-deck' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Unlink Deck do comitê' }));
  expect(await screen.findByText('No linked activities.')).toBeInTheDocument();
  expect(links).toEqual([]);
});

it('shows the same link from the activity and opens the meeting', async () => {
  links = [{ session: 's-1', note: 'n-deck', createdAt: 'now' }];
  render(<ItemLinks side="activity" noteId="n-deck" />);
  const chip = await screen.findByRole('button', { name: 'Pulso MX' });
  fireEvent.click(chip);
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: '/meetings/$sessionId',
    params: { sessionId: 's-1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Link meeting' }));
  const results = await screen.findByRole('list', { name: 'Meetings found' });
  // Already linked meetings are not offered again; the date helps tell them apart.
  expect(within(results).getAllByRole('button')).toHaveLength(1);
  expect(within(results).getByRole('button', { name: /Comitê de produto Oct 20, 2026/ }));
});

it('keeps a link to something deleted visible as missing', async () => {
  links = [{ session: 's-gone', note: 'n-deck', createdAt: 'now' }];
  render(<ItemLinks side="activity" noteId="n-deck" />);
  expect(await screen.findByRole('button', { name: 'Missing meeting' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Unlink Missing meeting' }));
  await waitFor(() => expect(links).toEqual([]));
});
