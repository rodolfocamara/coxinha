import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Outlet } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import {
  at,
  backend,
  calledWith,
  event,
  freshDb,
  recording,
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
vi.mock('../meetings/ProcessingPanel', () => ({
  ProcessingPanel: ({ meetingId }: { meetingId: string }) => <p>Pipeline {meetingId}</p>,
}));

/** Specs 0100, 0111 and 0115: which calendar meeting an earlier recording is. */
let db: Db;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 15, 12));
  resetState();
  await i18n.changeLanguage('en');
  db = freshDb();
  db.account = 'me@example.com';
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(backend(db));
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await i18n.changeLanguage('en');
});

const grid = () => document.querySelector<HTMLElement>('.ch-main')!;
const rail = () => screen.getByRole('complementary', { name: 'Calendar navigation and filters' });
const findRail = () =>
  screen.findByRole('complementary', { name: 'Calendar navigation and filters' });

function chromeRecording() {
  const committee = event({
    id: 'e-committee',
    title: 'IT committee',
    startsAt: at(-2, 9),
    endsAt: at(-2, 11),
    attendees: [{ name: 'Ana', email: 'ana@example.com' }],
  });
  const standup = event({
    id: 'e-standup',
    title: 'Standup',
    startsAt: at(-2, 9, 15),
    endsAt: at(-2, 9, 30),
  });
  const lunch = event({ id: 'e-lunch', title: 'Lunch', startsAt: at(-2, 12), endsAt: at(-2, 13) });
  db.events = [...db.events, committee, standup, lunch];
  db.sessions = [
    ...db.sessions,
    session({
      id: 's-chrome',
      title: 'Meeting in Google Chrome',
      status: 'completed',
      meeting_id: 'm-chrome',
      recording: recording('m-chrome', 'Meeting in Google Chrome', 'finished', at(-2, 9, 19)),
    }),
  ];
  db.calendarMatches = [
    {
      sessionId: 's-chrome',
      meetingId: 'm-chrome',
      title: 'Meeting in Google Chrome',
      startsAt: at(-2, 9, 19),
      endsAt: at(-2, 9, 29),
      event: committee,
    },
  ];
}

it('asks in the peek which calendar meeting a recording is, and links the one picked', async () => {
  chromeRecording();
  renderAt('/meetings');
  fireEvent.click(
    await within(await findRail()).findByRole('button', {
      name: /1 recording looks like a meeting on your calendar/,
    })
  );
  const peek = await screen.findByRole('complementary', { name: 'Meeting in Google Chrome' });
  const question = within(peek).getByRole('radiogroup', { name: 'Is this the meeting?' });
  const options = within(question).getAllByRole('radio');
  expect(options.map((o) => o.closest('label')!.textContent)).toEqual([
    expect.stringMatching(/IT committee.*1 invitee · likely/),
    expect.stringMatching(/Standup/),
  ]);
  expect(options[0]).toBeChecked();
  // The calendar keeps only the recording and the checked event in colour.
  const block = (key: string) => grid().querySelector(`[data-key="${key}"]`)!;
  expect(block('s:s-chrome')).toHaveAttribute('data-selected');
  expect(block('e:e-committee')).toHaveAttribute('data-candidate');
  expect(block('e:e-lunch')).toHaveAttribute('data-dimmed');
  fireEvent.click(options[1]);
  expect(block('e:e-standup')).toHaveAttribute('data-candidate');
  expect(block('e:e-committee')).toHaveAttribute('data-dimmed');
  fireEvent.click(within(peek).getByRole('button', { name: 'Same meeting' }));
  await waitFor(() =>
    expect(calledWith(db, 'library_resolve_calendar_match')).toEqual([
      { sessionId: 's-chrome', eventId: 'e-standup', accept: true },
    ])
  );
  await waitFor(() =>
    expect(within(rail()).queryByRole('button', { name: /looks like a meeting/ })).toBeNull()
  );
});

it('remembers "none of these" for the proposed event', async () => {
  chromeRecording();
  renderAt('/meetings');
  fireEvent.click(
    await within(await findRail()).findByRole('button', { name: /looks like a meeting/ })
  );
  const peek = await screen.findByRole('complementary', { name: 'Meeting in Google Chrome' });
  fireEvent.click(within(peek).getByRole('button', { name: 'None of these' }));
  await waitFor(() =>
    expect(calledWith(db, 'library_resolve_calendar_match')).toEqual([
      { sessionId: 's-chrome', eventId: 'e-committee', accept: false },
    ])
  );
  expect(
    await within(peek).findByRole('button', { name: 'Link to a calendar meeting' })
  ).toBeInTheDocument();
  expect(grid().querySelector('[data-dimmed]')).toBeNull();
});

it('moves the peek to the prepared session that took the recording', async () => {
  chromeRecording();
  db.sessions = [
    ...db.sessions,
    session({ id: 's-prep', title: 'IT committee', starts_at: at(-2, 9), ends_at: at(-2, 11) }),
  ];
  const base = backend(db);
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== 'library_resolve_calendar_match') return base(command, args);
    await base(command, args);
    const chrome = db.sessions.find((s) => s.id === 's-chrome')!;
    db.sessions = db.sessions
      .filter((s) => s.id !== 's-chrome')
      .map((s) =>
        s.id === 's-prep' ? { ...s, meeting_id: chrome.meeting_id, recording: chrome.recording } : s
      );
    return db.sessions.find((s) => s.id === 's-prep');
  });
  renderAt('/meetings');
  fireEvent.click(
    await within(await findRail()).findByRole('button', { name: /looks like a meeting/ })
  );
  const peek = await screen.findByRole('complementary', { name: 'Meeting in Google Chrome' });
  fireEvent.click(within(peek).getByRole('button', { name: 'Same meeting' }));
  expect(await screen.findByRole('complementary', { name: 'IT committee' })).toBeInTheDocument();
  await waitFor(() => expect(grid().querySelector('[data-key="s:s-chrome"]')).toBeNull());
  expect(grid().querySelector('[data-key="s:s-prep"]')).toHaveAttribute('data-selected');
});
