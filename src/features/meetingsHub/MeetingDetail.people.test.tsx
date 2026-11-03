import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Outlet } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import type { AttendeeResponse, CalendarEvent } from '../agenda/calendar';
import { hueFor } from './format';
import { PersonAvatar } from './PersonAvatar';
import { at, backend, event, freshDb, renderAt, resetState, type Db } from './meetingsHub.harness';

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
vi.mock('../meetings/ProcessingPanel', () => ({
  ProcessingPanel: () => <p>Pipeline</p>,
}));

const person = (
  name: string,
  response: AttendeeResponse['response'],
  kind: AttendeeResponse['kind'] = 'required'
): AttendeeResponse => ({ name, email: `${name.split(' ')[0]}@example.test`, response, kind });

const invited = (
  people: AttendeeResponse[],
  o: Partial<CalendarEvent> & { id: string; title: string }
) =>
  event({
    attendees: people.map(({ name, email }) => ({ name, email })),
    attendeeResponses: people,
    ...o,
  });

const team = [
  person('Ana Lima', 'organizer'),
  person('Bruno Dias', 'accepted'),
  person('Carla Reis', 'tentativelyAccepted', 'optional'),
  person('Diego Melo', 'notResponded'),
];

const forty = Array.from({ length: 40 }, (_, i) =>
  person(`Person ${i}`, i < 14 ? 'accepted' : i < 18 ? 'declined' : 'notResponded')
);

let db: Db;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 15, 12));
  resetState();
  await i18n.changeLanguage('en');
  db = freshDb();
  db.account = 'me@example.com';
  vi.mocked(invoke).mockImplementation(backend(db) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const open = async (title: RegExp, name: string) => {
  renderAt('/meetings?view=week');
  await screen.findByRole('heading', { name: /October/ });
  const grid = document.querySelector<HTMLElement>('.ch-main')!;
  fireEvent.click(await within(grid).findByRole('button', { name: title }));
  return screen.findByRole('complementary', { name });
};

it('keeps the flat list and claims no group for a cache without responses', async () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ name: `Guest ${i}`, email: null }));
  db.events = [event({ id: 'e', title: 'Older cache', attendees: many })];
  const panel = await open(/Older cache/, 'Older cache');
  expect(panel.querySelectorAll('.ch-person')).toHaveLength(6);
  expect(within(panel).getByText('and 3 more')).toBeInTheDocument();
  expect(panel.querySelector('.ch-disclosure-toggle')).toBeNull();
});

it('lists invitees by response with organizer, required or optional', async () => {
  db.events = [invited(team, { id: 'e', title: 'Sync' })];
  const panel = await open(/Sync/, 'Sync');
  const role = (name: string) =>
    within(within(panel).getByText(name).closest('li')!).getByText(/Organizer|Required|Optional/);
  expect(role('Ana Lima')).toHaveTextContent('Organizer');
  expect(role('Bruno Dias')).toHaveTextContent('Required');
  expect(role('Carla Reis')).toHaveTextContent('Optional');
  expect(within(panel).getByText('4 invited: 3 required, 1 optional')).toBeInTheDocument();
  for (const toggle of panel.querySelectorAll('.ch-disclosure-toggle'))
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

it('keeps a long list collapsed, with counts, and opens a group by its control', async () => {
  db.events = [invited(forty, { id: 'e', title: 'All hands' })];
  const panel = await open(/All hands/, 'All hands');
  expect(within(panel).getByText('40 invited: 40 required, 0 optional')).toBeInTheDocument();
  const accepted = within(panel).getByRole('button', { name: /Accepted \(14\)/ });
  const declined = within(panel).getByRole('button', { name: /Declined \(4\)/ });
  const none = within(panel).getByRole('button', { name: /No answer \(22\)/ });
  for (const toggle of [accepted, declined, none])
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(within(panel).getByText('Person 0')).not.toBeVisible();
  fireEvent.click(accepted);
  expect(accepted).toHaveAttribute('aria-expanded', 'true');
  expect(within(panel).getByText('Person 0')).toBeVisible();
  expect(within(panel).getByText('Person 14')).not.toBeVisible();
  // Its control points at what it opens.
  expect(document.getElementById(accepted.getAttribute('aria-controls')!)).toContainElement(
    within(panel).getByText('Person 0')
  );
});

it('keeps who accepted open on a longer upcoming list, not on a past one', async () => {
  const twelve = [
    ...team,
    ...Array.from({ length: 8 }, (_, i) => person(`Guest ${i}`, 'notResponded')),
  ];
  db.events = [invited(twelve, { id: 'e', title: 'Sync' })];
  let panel = await open(/Sync/, 'Sync');
  expect(within(panel).getByRole('button', { name: /Accepted \(2\)/ })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  expect(within(panel).getByRole('button', { name: /No answer \(9\)/ })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  cleanup();
  db.events = [
    invited(twelve, { id: 'e', title: 'Over', startsAt: at(-1, 9), endsAt: at(-1, 10) }),
  ];
  panel = await open(/Over/, 'Over');
  expect(within(panel).getByRole('button', { name: /Accepted \(2\)/ })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
});

it('draws initials on a stable hue, and takes a photo that may fail', () => {
  const { container, rerender } = render(<PersonAvatar name="Ana Lima" />);
  const avatar = container.querySelector<HTMLElement>('.mh-av')!;
  expect(avatar).toHaveTextContent('AL');
  expect(avatar).toHaveAttribute('aria-hidden', 'true');
  expect(avatar.style.background).toContain(`--p${hueFor('Ana Lima')}-bg`);
  rerender(<PersonAvatar name="Ana Lima" hue={2} />);
  expect(avatar.style.background).toContain('--p2-bg');

  rerender(<PersonAvatar name="Ana Lima" photo="file:///photo.png" />);
  const photo = container.querySelector('img')!;
  expect(photo).toHaveAttribute('src', 'file:///photo.png');
  expect(avatar).not.toHaveTextContent('AL');
  fireEvent.error(photo);
  expect(container.querySelector('img')).toBeNull();
  expect(avatar).toHaveTextContent('AL');
});
