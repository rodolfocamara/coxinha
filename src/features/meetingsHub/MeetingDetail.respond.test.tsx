import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Outlet } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import i18n from '../../lib/i18n';
import type { CalendarEvent } from '../agenda/calendar';
import { invited, openPeek, team } from './meetingDetail.harness';
import {
  at,
  backend,
  calledWith,
  freshDb,
  propValue,
  renderAt,
  resetState,
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

const organizer = { name: 'Ana Lima', email: 'ana@example.test' };
const invite = (o: Partial<CalendarEvent> = {}) =>
  invited(team, {
    id: 'e',
    title: 'Sync',
    organizer,
    response: 'notResponded',
    startsAt: at(1, 14),
    endsAt: at(1, 15),
    ...o,
  });
const open = async (event: CalendarEvent = invite()) => {
  db.events = [event];
  const panel = await openPeek(/Sync/, 'Sync');
  return panel;
};
const compose = async (event?: CalendarEvent) => {
  const panel = await open(event);
  fireEvent.click(
    within(panel).getByRole('button', {
      name: /Respond to this invitation|Change your response/,
    })
  );
  const dialog = await screen.findByRole('dialog');
  return { panel, dialog };
};
const pick = (dialog: HTMLElement, name: string) =>
  fireEvent.click(within(dialog).getByRole('radio', { name }));
const toReview = (dialog: HTMLElement) =>
  fireEvent.click(within(dialog).getByRole('button', { name: 'Review' }));
const sent = () => calledWith(db, 'calendar_respond');

it('shows the current response with the action, for an invitee', async () => {
  const panel = await open();
  expect(propValue(panel, 'Response')).toHaveTextContent('Not answered');
  expect(
    within(panel).getByRole('button', { name: 'Respond to this invitation' })
  ).toBeInTheDocument();
});

it('offers changing an answer already given', async () => {
  const panel = await open(invite({ response: 'accepted' }));
  expect(propValue(panel, 'Response')).toHaveTextContent('Accepted');
  expect(within(panel).getByRole('button', { name: 'Change your response' })).toHaveTextContent(
    'Change'
  );
});

it.each([
  ['the organizer', { isOrganizer: true, response: 'organizer' as const }],
  ['a cancelled event', { cancelled: true }],
])('offers nothing to %s', async (_, change) => {
  const panel = await open(invite(change));
  expect(within(panel).queryByRole('button', { name: /Respond to|Change your/ })).toBeNull();
});

it('offers nothing on a personal block, which has no response row', async () => {
  const panel = await open(
    invite({ attendees: [], attendeeResponses: [], organizer: null, response: null })
  );
  expect(within(panel).queryByRole('button', { name: /Respond to|Change your/ })).toBeNull();
});

it('sends nothing while composing, and asks for a choice before the review', async () => {
  const { dialog } = await compose();
  toReview(dialog);
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Choose a response.');
  expect(within(dialog).queryByRole('button', { name: /^Send/ })).toBeNull();
  pick(dialog, 'Accept');
  fireEvent.change(within(dialog).getByRole('textbox', { name: /Comment/ }), {
    target: { value: 'See you there' },
  });
  expect(sent()).toEqual([]);
});

it('reviews who receives what, and sends only on the second action', async () => {
  const { dialog, panel } = await compose();
  pick(dialog, 'Tentative');
  fireEvent.change(within(dialog).getByRole('textbox', { name: /Comment/ }), {
    target: { value: 'Running late\nmaybe' },
  });
  toReview(dialog);
  const send = await within(dialog).findByRole('button', { name: 'Send to Ana Lima' });
  expect(dialog).toHaveTextContent('This goes to Ana Lima and cannot be recalled.');
  const review = dialog.querySelector('.ch-respond-review')!;
  expect(review).toHaveTextContent('Ana Lima');
  expect(review).toHaveTextContent('ana@example.test');
  expect(review).toHaveTextContent('Tentative');
  expect(review).toHaveTextContent('Running late');
  expect(review).toHaveTextContent('This meeting');
  expect(document.activeElement).toHaveClass('ch-respond-claim');
  expect(sent()).toEqual([]);
  expect(propValue(panel, 'Response')).toHaveTextContent('Not answered');

  fireEvent.click(send);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(sent()).toEqual([
    {
      eventId: 'e',
      request: {
        kind: 'tentative',
        scope: 'occurrence',
        comment: 'Running late\nmaybe',
        notify: true,
        proposed: null,
      },
    },
  ]);
  await waitFor(() => expect(propValue(panel, 'Response')).toHaveTextContent('Tentative'));
  expect(within(panel).getByRole('status')).toHaveTextContent('Sent to Ana Lima');
});

it('returns to the composed answer from the review, with what was typed', async () => {
  const { dialog } = await compose();
  pick(dialog, 'Decline');
  fireEvent.change(within(dialog).getByRole('textbox', { name: /Comment/ }), {
    target: { value: 'On leave' },
  });
  toReview(dialog);
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Back' }));
  expect(within(dialog).getByRole('radio', { name: 'Decline' })).toBeChecked();
  expect(within(dialog).getByRole('textbox', { name: /Comment/ })).toHaveValue('On leave');
  expect(sent()).toEqual([]);
});

it('says nobody is told when notifying is off, and has no comment to send', async () => {
  const { dialog, panel } = await compose();
  pick(dialog, 'Accept');
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Notify Ana Lima' }));
  expect(within(dialog).queryByRole('textbox', { name: /Comment/ })).toBeNull();
  toReview(dialog);
  const save = await within(dialog).findByRole('button', { name: 'Save without notifying' });
  expect(dialog).toHaveTextContent('Nothing goes to the organizer.');
  expect(dialog).toHaveTextContent('Nobody, the organizer is not notified');
  fireEvent.click(save);
  await waitFor(() => expect(sent()).toHaveLength(1));
  expect(sent()[0]).toEqual({
    eventId: 'e',
    request: { kind: 'accept', scope: 'occurrence', comment: null, notify: false, proposed: null },
  });
  await waitFor(() =>
    expect(within(panel).getByRole('status')).toHaveTextContent('Saved, organizer not notified')
  );
});

it('starts silent when the organizer did not ask for responses, and says so', async () => {
  const { dialog } = await compose(invite({ responseRequested: false }));
  const notify = within(dialog).getByRole('checkbox', { name: /Notify Ana Lima/ });
  expect(notify).not.toBeChecked();
  expect(notify.closest('label')).toHaveTextContent('The organizer did not ask for responses.');
});

it('asks about the scope only for a recurring event', async () => {
  const single = await compose();
  expect(within(single.dialog).queryByRole('group', { name: 'Applies to' })).toBeNull();
  cleanup();
  const { dialog } = await compose(invite({ seriesMasterId: 'master', eventType: 'occurrence' }));
  const group = within(dialog).getByRole('group', { name: 'Applies to' });
  expect(within(group).getByRole('radio', { name: /This occurrence/ })).toBeChecked();
  pick(dialog, 'Accept');
  pick(dialog, 'The whole series');
  toReview(dialog);
  const send = await within(dialog).findByRole('button', { name: 'Send to Ana Lima' });
  expect(dialog.querySelector('.ch-respond-review')).toHaveTextContent('The whole series');
  fireEvent.click(send);
  await waitFor(() => expect(sent()).toHaveLength(1));
  expect(sent()[0]).toMatchObject({ eventId: 'e', request: { kind: 'accept', scope: 'series' } });
});

it('proposes a time in the owner zone, for one occurrence, always notified', async () => {
  const { dialog } = await compose(invite({ seriesMasterId: 'master', eventType: 'occurrence' }));
  pick(dialog, 'Propose a new time');
  const { timeZone } = new Intl.DateTimeFormat().resolvedOptions();
  expect(dialog).toHaveTextContent(`Times in ${timeZone}`);
  expect(within(dialog).getByRole('radio', { name: /The whole series/ })).toBeDisabled();
  expect(within(dialog).getByRole('checkbox', { name: /Notify Ana Lima/ })).toBeDisabled();
  expect(within(dialog).getByRole('checkbox', { name: /Notify Ana Lima/ })).toBeChecked();
  toReview(dialog);
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('current time');
  fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '16:00' } });
  fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '16:30' } });
  within(dialog).getAllByRole('radio', { name: 'Decline' }).at(-1)!.click();
  toReview(dialog);
  const send = await within(dialog).findByRole('button', { name: 'Send to Ana Lima' });
  const review = dialog.querySelector('.ch-respond-review')!;
  expect(review).toHaveTextContent('Decline, with a new time');
  expect(review).toHaveTextContent('04:00 PM–04:30 PM');
  expect(review).toHaveTextContent(timeZone);
  expect(sent()).toEqual([]);
  fireEvent.click(send);
  await waitFor(() => expect(sent()).toHaveLength(1));
  const day = new Date(at(1, 14));
  const when = (hours: number, minutes: number) =>
    new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes)
      .toISOString()
      .replace('.000', '');
  expect(sent()[0]).toEqual({
    eventId: 'e',
    request: {
      kind: 'decline',
      scope: 'occurrence',
      comment: null,
      notify: true,
      proposed: { startsAt: when(16, 0), endsAt: when(16, 30) },
    },
  });
});

it('does not offer a proposal when the organizer forbids it', async () => {
  const { dialog } = await compose(invite({ allowNewTimeProposals: false }));
  const propose = within(dialog).getByRole('radio', { name: /Propose a new time/ });
  expect(propose).toBeDisabled();
  expect(dialog).toHaveTextContent('The organizer does not allow proposing a new time.');
});

it('keeps a failure visible with what was typed, and retries only when asked', async () => {
  db.respond.errors = ['calendar.respondOffline'];
  const { dialog, panel } = await compose();
  pick(dialog, 'Accept');
  fireEvent.change(within(dialog).getByRole('textbox', { name: /Comment/ }), {
    target: { value: 'Yes' },
  });
  toReview(dialog);
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Send to Ana Lima' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'No connection to Outlook. Nothing was sent.'
  );
  expect(sent()).toHaveLength(1);
  expect(propValue(panel, 'Response')).toHaveTextContent('Not answered');
  expect(dialog.querySelector('.ch-respond-review')).toHaveTextContent('Yes');
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(sent()).toHaveLength(1);

  fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(sent()).toHaveLength(2);
  expect(sent()[1]).toEqual(sent()[0]);
  await waitFor(() => expect(propValue(panel, 'Response')).toHaveTextContent('Accepted'));
});

it.each([
  ['calendar.respondUncertain', 'may have arrived'],
  ['calendar.respondReconnect', 'Reconnect Outlook'],
  ['calendar.respondRejected', 'refused'],
  ['calendar.eventMissing', 'no longer in the Outlook calendar'],
  ['calendar.respondFailed', 'did not take'],
  ['something odd', 'Could not complete'],
])('explains %s', async (code, text) => {
  db.respond.errors = [code];
  const { dialog } = await compose();
  pick(dialog, 'Accept');
  toReview(dialog);
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Send to Ana Lima' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(text);
  expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeEnabled();
});

it('locks while sending: one request, no second click, no closing', async () => {
  let release = () => undefined as void;
  db.respond.gate = new Promise((resolve) => {
    release = resolve;
  });
  const { dialog } = await compose();
  pick(dialog, 'Accept');
  toReview(dialog);
  const send = await within(dialog).findByRole('button', { name: 'Send to Ana Lima' });
  fireEvent.click(send);
  await waitFor(() => expect(send).toHaveTextContent('Sending…'));
  expect(send).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Back' })).toBeDisabled();
  fireEvent.click(send);
  fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  release();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(sent()).toHaveLength(1);
});

it('answers the whole series on every cached occurrence', async () => {
  db.events = [
    invite({ seriesMasterId: 'master', eventType: 'occurrence' }),
    invite({
      id: 'e2',
      title: 'Next',
      seriesMasterId: 'master',
      startsAt: at(2, 14),
      endsAt: at(2, 15),
    }),
  ];
  const panel = await openPeek(/Sync/, 'Sync');
  fireEvent.click(within(panel).getByRole('button', { name: 'Respond to this invitation' }));
  const dialog = await screen.findByRole('dialog');
  pick(dialog, 'Decline');
  pick(dialog, 'The whole series');
  toReview(dialog);
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Send to Ana Lima' }));
  await waitFor(() => expect(propValue(panel, 'Response')).toHaveTextContent('Declined'));
  expect(db.events.map((e) => e.response)).toEqual(['declined', 'declined']);
});

it('answers from the meeting page inspector too, in the same two steps', async () => {
  db.events = [invite({ id: 'e-page' })];
  renderAt('/meetings?event=e-page');
  const inspector = await screen.findByRole('complementary', { name: 'Meeting details' });
  expect(propValue(inspector, 'Response')).toHaveTextContent('Not answered');
  fireEvent.click(within(inspector).getByRole('button', { name: 'Respond to this invitation' }));
  const dialog = await screen.findByRole('dialog');
  pick(dialog, 'Accept');
  toReview(dialog);
  const send = await within(dialog).findByRole('button', { name: 'Send to Ana Lima' });
  expect(sent()).toEqual([]);
  fireEvent.click(send);
  await waitFor(() => expect(propValue(inspector, 'Response')).toHaveTextContent('Accepted'));
  expect(sent()).toHaveLength(1);
});

it('speaks Portuguese in the sheet', async () => {
  db.events = [invite()];
  const panel = await openPeek(/Sync/, 'Sync');
  await act(() => i18n.changeLanguage('pt-BR'));
  fireEvent.click(within(panel).getByRole('button', { name: 'Responder a este convite' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('radio', { name: 'Propor novo horário' })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('radio', { name: 'Aceitar' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Revisar' }));
  expect(await within(dialog).findByRole('button', { name: 'Enviar a Ana Lima' })).toBeEnabled();
  expect(dialog).toHaveTextContent('não pode ser desfeito');
});
