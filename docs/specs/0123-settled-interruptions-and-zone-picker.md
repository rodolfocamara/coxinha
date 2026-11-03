# 0123 — Settled interruptions, and time zones by country

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

- "DR" and "RH: Escala 6x1" sit in "To review" for good. Both captures were
  cut by an unclean exit, recovered, transcribed and named. Recovery ends in
  the state `interrupted`, the review list asks for action on every
  `interrupted` capture, and pressing recover only repeats the checksum.
  Nothing can clear them.
- The owner did not find the extra time zones of spec 0119 P4. They sit in
  Settings → Agenda, away from the grid, and ask for an IANA name: typing
  "Israel" finds nothing, because the zone is `Asia/Jerusalem`.

## Non-goals

- Changing the raw capture state. `interrupted` stays true and keeps its gap
  in `timing.jsonl`.
- Reading additional time zones from Outlook. Graph exposes only the
  mailbox's own zone.

## Design

### P1 A sealed interruption is a closed recording

- A meeting summary carries `needsRecovery`: true while `recording`, or when
  `interrupted` and the manifest has a track without a checksum (or cannot
  be read). A recovered capture has every checksum.
- Only `needsRecovery` raises "recover" in the review list, the row and the
  meeting banner. A sealed interruption then follows the rules of a finished
  recording: processing, failed, untranscribed, or nothing to review.

### P2 Pick a time zone by country or city

- The settings field searches country names in the app's language and in
  English, city names and IANA names, ignoring accents and case. Picking a
  result adds it at once, labelled with the country code (IL, MX), which the
  owner can edit. Any other IANA name still works.
- Countries with several zones list one row per main city.
- This computer's column defaults to its country code when the zone is known,
  as in Outlook ("BR"), else to the short zone name.

### P3 The agenda leads to the setting

- The calendar toolbar has a time zone button, opening Settings → Agenda.

## Acceptance criteria

- [ ] A recovered capture reports no recovery needed, and an unsealed or
  unreadable one does. (`capture::recording` tests)
- [ ] A sealed interruption leaves the review list unless it lacks a
  transcript, and an unsealed one stays. (`meetingRows.test.ts`,
  `MeetingsHub.detail.test.tsx`)
- [ ] "Israel", "méxico" and "Sao Paulo" find their zones, and an IANA name
  still does. (`zoneCatalog.test.ts`)
- [ ] Picking a result adds the zone with its country code, editable.
  (`CalendarSection.test.tsx`)
- [ ] The toolbar button opens the setting. (`MeetingsHub.week.test.tsx`)
- [ ] Owner: DR and RH leave "To review", and IL and MX show in the grid.
