import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../lib/i18n';
import type { ItemFilesData } from './items';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));

import { ItemFiles } from './ItemFiles';

const item = { kind: 'meeting' as const, id: 's-1', title: 'Pulso MX', date: '2026-11-03' };
let data: ItemFilesData;
const calls = (command: string) =>
  mocks.invoke.mock.calls.filter(([c]) => c === command).map(([, args]) => args);

beforeEach(async () => {
  await i18n.changeLanguage('en');
  data = { folder: null, files: [], references: [] };
  mocks.open.mockReset();
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    switch (command) {
      case 'items_list':
        return data;
      case 'items_include':
        data = {
          folder: '/vault/meetings/2026-11-03 Pulso MX',
          files: (args.paths as string[]).map((p) => ({
            name: p.split('/').pop()!,
            kind: 'html',
            bytes: 2048,
            modified: '2026-11-03T10:00:00Z',
          })),
          references: data.references,
        };
        return data;
      case 'items_reference':
        data = {
          ...data,
          folder: data.folder ?? '/vault/meetings/2026-11-03 Pulso MX',
          references: [
            {
              target: String(args.target),
              label: null,
              addedAt: 'now',
              isUrl: true,
              missing: false,
            },
          ],
        };
        return data;
      case 'items_remove_file':
        data = { ...data, files: data.files.filter((f) => f.name !== args.name) };
        return data;
      case 'items_open':
      case 'items_reveal':
        return null;
      default:
        throw new Error(`unexpected ${command}`);
    }
  });
});
afterEach(cleanup);

it('starts empty and lists nothing until something is added', async () => {
  render(<ItemFiles item={item} heading />);
  expect(await screen.findByText(/No files yet/)).toBeInTheDocument();
  expect(calls('items_list')[0]).toEqual({ item });
  expect(screen.queryByRole('button', { name: 'Show in folder' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Files' })).toBeInTheDocument();
});

it('includes chosen files, opens them and reveals the folder', async () => {
  mocks.open.mockResolvedValue(['/home/me/deck.html']);
  render(<ItemFiles item={item} />);
  await screen.findByText(/No files yet/);
  fireEvent.click(screen.getByRole('button', { name: 'Include file' }));
  const open = await screen.findByRole('button', { name: 'Open deck.html' });
  expect(mocks.open).toHaveBeenCalledWith({ multiple: true, directory: false });
  expect(calls('items_include')[0]).toEqual({ item, paths: ['/home/me/deck.html'] });
  expect(screen.getByText(/HTML · 2 kB/)).toBeInTheDocument();
  fireEvent.click(open);
  await waitFor(() =>
    expect(calls('items_open')[0]).toEqual({ item, target: { kind: 'file', name: 'deck.html' } })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }));
  await waitFor(() => expect(calls('items_reveal')).toHaveLength(1));
});

it('references a URL without copying and opens it as a reference', async () => {
  render(<ItemFiles item={item} />);
  await screen.findByText(/No files yet/);
  fireEvent.click(screen.getByRole('button', { name: 'Reference' }));
  const field = screen.getByLabelText(/web address or a file/);
  fireEvent.change(field, { target: { value: 'https://example.com/deck' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  const open = await screen.findByRole('button', { name: 'Open https://example.com/deck' });
  expect(calls('items_reference')[0]).toEqual({
    item,
    target: 'https://example.com/deck',
    label: null,
  });
  expect(screen.queryByLabelText(/web address or a file/)).toBeNull();
  fireEvent.click(open);
  await waitFor(() =>
    expect(calls('items_open')[0]).toEqual({
      item,
      target: { kind: 'reference', target: 'https://example.com/deck' },
    })
  );
});

it('asks before moving an included file to the trash', async () => {
  data = {
    folder: '/vault/meetings/x',
    files: [{ name: 'deck.html', kind: 'html', bytes: 10, modified: '' }],
    references: [],
  };
  render(<ItemFiles item={item} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Remove deck.html' }));
  const list = screen.getByRole('list', { name: 'Files and references' });
  expect(within(list).getByText('Move to the vault trash?')).toBeInTheDocument();
  fireEvent.click(within(list).getByRole('button', { name: 'Cancel' }));
  expect(calls('items_remove_file')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Remove deck.html' }));
  fireEvent.click(within(list).getByRole('button', { name: 'Remove' }));
  await waitFor(() => expect(calls('items_remove_file')[0]).toEqual({ item, name: 'deck.html' }));
  expect(await screen.findByText(/No files yet/)).toBeInTheDocument();
});

it('flags a missing referenced file and shows backend errors', async () => {
  data = {
    folder: '/vault/meetings/x',
    files: [],
    references: [
      { target: '/repo/deck.html', label: null, addedAt: '', isUrl: false, missing: true },
    ],
  };
  mocks.open.mockResolvedValue(['/a.html']);
  render(<ItemFiles item={item} />);
  expect(await screen.findByRole('button', { name: 'Open /repo/deck.html' })).toBeDisabled();
  expect(screen.getByText('not found')).toBeInTheDocument();
  mocks.invoke.mockRejectedValueOnce('not a file: /a.html');
  fireEvent.click(screen.getByRole('button', { name: 'Include file' }));
  expect(await screen.findByText('not a file: /a.html')).toBeInTheDocument();
});
