import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Outlet } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import {
  backend,
  calledWith,
  event,
  freshDb,
  fromNow,
  renderAt,
  resetState,
  session,
  type Db,
} from './meetingsHub.harness';

vi.mock('../../routes/__root', () => ({ RootLayout: () => <Outlet /> }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
  convertFileSrc: (path: string) => path,
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('../notes/NoteEditor', () => ({
  NoteEditor: () => <div role="textbox" aria-label="Meeting notes" />,
  NoteLoadingSkeleton: () => <p>Loading editor</p>,
}));
vi.mock('../meetings/ProcessingPanel', () => ({ ProcessingPanel: () => <p>Pipeline</p> }));

let db: Db;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 3, 9));
  resetState();
  await i18n.changeLanguage('en');
  db = freshDb();
  db.account = 'me@example.com';
  db.sessions = [
    session({
      id: 'atlas',
      title: 'Project Atlas',
      starts_at: new Date(2026, 10, 3, 13, 30).toISOString(),
      ends_at: new Date(2026, 10, 3, 15, 20).toISOString(),
    }),
  ];
  db.events = [event({ id: 'e-q4', title: 'Q4 planning', startsAt: fromNow(60) })];
  const note = (id: string, title: string) => ({
    id,
    title,
    path: `notes/${id}.md`,
    tags: [],
    created_at: '',
    updated_at: '',
  });
  db.notes = [note('n-deck', 'Deck do comitê'), note('n-api', 'Contrato de API v2')];
  vi.mocked(invoke).mockImplementation(backend(db));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const detail = () => screen.getByRole('article');

it('keeps files in a Files tab of the meeting, named by date and title', async () => {
  renderAt('/meetings/atlas');
  await screen.findByRole('heading', { level: 2, name: 'Project Atlas' });
  fireEvent.click(within(detail()).getByRole('tab', { name: 'Files' }));
  expect(await within(detail()).findByText(/No files yet/)).toBeInTheDocument();
  expect(calledWith(db, 'items_list')[0]).toEqual({
    item: { kind: 'meeting', id: 'atlas', title: 'Project Atlas', date: '2026-11-03' },
  });
  expect(within(detail()).getByRole('button', { name: 'Include file' })).toBeInTheDocument();
});

it('links an activity from the meeting inspector', async () => {
  renderAt('/meetings/atlas');
  const inspector = await screen.findByRole('complementary', { name: 'Meeting details' });
  expect(await within(inspector).findByText('No linked activities.')).toBeInTheDocument();
  fireEvent.click(within(inspector).getByRole('button', { name: 'Link activity' }));
  const results = await within(inspector).findByRole('list', { name: 'Activities found' });
  fireEvent.click(within(results).getByRole('button', { name: 'Deck do comitê' }));
  await waitFor(() =>
    expect(db.links).toEqual([{ session: 'atlas', note: 'n-deck', createdAt: 'now' }])
  );
  expect(
    within(await within(inspector).findByRole('list', { name: 'Activities' })).getByRole('button', {
      name: 'Deck do comitê',
    })
  ).toBeInTheDocument();
});

it('asks to prepare an Outlook-only meeting before keeping files', async () => {
  renderAt('/meetings?event=e-q4');
  await screen.findByRole('heading', { level: 2, name: 'Q4 planning' });
  fireEvent.click(within(detail()).getByRole('tab', { name: 'Files' }));
  expect(
    await within(detail()).findByText('Prepare the meeting to keep files with it.')
  ).toBeInTheDocument();
  expect(within(detail()).getAllByRole('button', { name: /Prepare/ }).length).toBeGreaterThan(0);
  expect(calledWith(db, 'items_list')).toEqual([]);
  expect(screen.queryByRole('button', { name: 'Link activity' })).toBeNull();
});
