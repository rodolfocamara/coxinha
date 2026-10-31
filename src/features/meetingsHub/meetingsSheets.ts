import { nameForTransition, prepareRouteTransition } from '../../lib/motion';

export type MeetingsSheet = 'meeting' | 'import';

export const NEW_MEETING_EVENT = 'coxinha:new-meeting';
export const IMPORT_AUDIO_EVENT = 'coxinha:import-audio';

let pendingSheet: MeetingsSheet | null = null;

/**
 * Asks Reuniões to open a sheet. Works before the screen mounts (the request
 * waits) and while it is mounted (the window event opens it at once).
 */
export function requestMeetingsSheet(sheet: MeetingsSheet) {
  pendingSheet = sheet;
  window.dispatchEvent(new Event(sheet === 'meeting' ? NEW_MEETING_EVENT : IMPORT_AUDIO_EVENT));
}

/** Reads and clears a request made before the screen mounted. */
export function takePendingSheet() {
  const sheet = pendingSheet;
  pendingSheet = null;
  return sheet;
}

let pendingTitleMorph = false;

/**
 * Navigation from another screen to a meeting. When the clicked element shows
 * the meeting title, its title morphs into the detail heading (`m-title`).
 * Returns the `viewTransition` value for TanStack's `navigate`.
 */
export function meetingTransition(titleElement?: Element | null) {
  const value = prepareRouteTransition('nav');
  if (value && titleElement) {
    nameForTransition(titleElement, 'm-title');
    pendingTitleMorph = true;
  }
  return value;
}

/** Gives the detail heading the shared name only during a pending morph. */
export function claimTitleMorph(heading: Element | null) {
  if (!pendingTitleMorph) return;
  pendingTitleMorph = false;
  if (document.documentElement.dataset.vt) nameForTransition(heading, 'm-title');
}
