# 0111 — Confirm a recording's meeting in the peek

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

Spec 0100 asks whether earlier recordings ("Meeting in Google Chrome") are
calendar meetings in a separate sheet. The owner looks at recordings on the
calendar and expects to answer there: "pra confirmar se uma gravação é de uma
reunião, tem que ser nessa tela" (the peek, 2026-11-03). The sheet also
offered only the one proposed event, so a recording next to two meetings
could not be linked to the other.

## Non-goals

- Changing the matching rules or the accept and decline commands of spec
  0100 (`library_calendar_matches`, `library_resolve_calendar_match`).
- Linking events to recordings that already have one.

## Design

### P1 The question in the peek (`PeekCalendarMatch`)

- The peek of a past session with a recording and no calendar event shows,
  under the chips, "É esta reunião?" with up to four events as radio rows:
  the proposal first, marked "provável", then the events within 30 minutes of
  the recording by overlap (cancelled and all-day events left out). Each row
  has the event's category colour, title, time and invitee count.
- "É essa reunião" links the checked event (spec 0100 P3: title, time and
  invitees come from the event). "Nenhuma destas" remembers the proposal as
  declined.
- Without a proposal the peek shows only "Vincular a uma reunião da agenda",
  which opens the same list.

### P2 The calendar shows the two in question

- While the question is open, the grid dims and greys every block except
  the recording (selected) and the checked event (dashed outline). Checking
  another event moves the highlight; closing the peek or answering restores
  the colours. Reduced motion drops the fade.

### P3 The rail leads to the peek

- "Vincular à agenda" with the count sits in the rail under "A revisar"'s
  shape. It moves the calendar to the first such recording and opens its
  peek. The separate sheet is gone.

## Acceptance

- [x] Candidates: proposal first, nearby events by overlap, no cancelled or
      all-day events, at most four (`peekMatch` tests).
- [x] The rail opens the recording's peek; only the recording and the
      checked event stay in colour; picking another event links it; "Nenhuma
      destas" declines the proposal and restores the colours
      (`MeetingsHub.home` tests).
- [ ] Owner: a "Meeting in Google Chrome" recording linked from the peek.

## Evidence

- `peekMatch.test.ts` (1), `MeetingsHub.home.test.tsx` (2 new).
