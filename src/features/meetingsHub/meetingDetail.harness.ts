import { fireEvent, screen, within } from '@testing-library/react';
import { expect } from 'vitest';
import type { AttendeeResponse, CalendarEvent } from '../agenda/calendar';
import type { MeetingSignals } from '../meetings/library';
import { at, event, recording, renderAt, session } from './meetingsHub.harness';

/** Shared by the tests of the meeting detail panel (spec 0126). */
export const person = (
  name: string,
  response: AttendeeResponse['response'],
  kind: AttendeeResponse['kind'] = 'required'
): AttendeeResponse => ({ name, email: `${name.split(' ')[0]}@example.test`, response, kind });

export const invited = (
  people: AttendeeResponse[],
  o: Partial<CalendarEvent> & { id: string; title: string }
) =>
  event({
    attendees: people.map(({ name, email }) => ({ name, email })),
    attendeeResponses: people,
    ...o,
  });

export const team = [
  person('Ana Lima', 'organizer'),
  person('Bruno Dias', 'accepted'),
  person('Carla Reis', 'tentativelyAccepted', 'optional'),
  person('Diego Melo', 'notResponded'),
];

export const signals = (sessionId: string, o: Partial<MeetingSignals> = {}): MeetingSignals => ({
  sessionId,
  transcript: false,
  speakers: { named: 0, unnamed: 0 },
  note: false,
  preparation: false,
  diagram: false,
  summary: false,
  followUps: { linked: 0, actions: 0 },
  generatedContent: false,
  mark: null,
  ...o,
});

export const recorded = () =>
  session({
    id: 'rec',
    title: 'Recorded sync',
    starts_at: at(-1, 9),
    ends_at: at(-1, 10),
    status: 'completed',
    meeting_id: 'm-rec',
    recording: recording('m-rec', 'Recorded sync'),
    transcript_status: 'available',
    processing_state: 'succeeded',
  });

export const speakers = (names: string[]) => ({
  jobs: [],
  people: [],
  report: {
    job: 'j',
    turns: [],
    warnings: [],
    corrections: {},
    segments: [{ id: 'a', track: 'mic', start_ms: 0, end_ms: 1, text: 'hello', speaker: 's0' }],
    assignments: names.map((name, i) => ({
      id: `a${i}`,
      speaker: `s${i}`,
      track: 'mic',
      person_id: `p${i}`,
      state: 'confirmed',
      name,
    })),
  },
});

export const openPeek = async (title: RegExp, name: string) => {
  renderAt('/meetings?view=week');
  await screen.findByRole('heading', { name: /October/ });
  const grid = document.querySelector<HTMLElement>('.ch-main')!;
  fireEvent.click(await within(grid).findByRole('button', { name: title }));
  return screen.findByRole('complementary', { name });
};
export const primaries = (panel: HTMLElement) =>
  [...panel.querySelectorAll('[data-variant="primary"]')].map((b) => b.textContent);
export const before = (a: Element, b: Element) =>
  expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
