# 0100 — Match past recordings to calendar events

Status: in-progress
Phase: F1
Date: 2026-11-02

## Why

With Outlook connected, the owner expects the recordings made before the
connection ("Meeting in Google Chrome") to be recognized as the meetings on
the calendar, after asking, so that title, time and participants come from
the event. Automatic capture already does this for new calls (spec 0097 P2);
earlier recordings were left behind.

## Non-goals

- Changing anything without a confirmation. A match is a suggestion until
  the owner says it is the same meeting.
- An event ID column on sessions. The list already links a session to an
  event by title and start (`matchEvent`, spec 0096 P4); confirming writes
  exactly that.
- Recordings older than the calendar window (30 days back).

## Design

### P1 Calendar history

- The Outlook cache covers 30 days back instead of 1, so recordings of the
  last month can be matched. Same request, same paging limits.

### P2 Proposals (`src-tauri/src/library/calendar_match.rs`)

- A recording qualifies when its session has a finished or interrupted
  capture of at least one minute. Its interval is `meeting.created_at`
  (UTC) plus the longest track in the manifest.
- An event qualifies when it is not cancelled, not all-day and has a title.
- The proposal is the event with the longest overlap, if the overlap is at
  least half the recording or 10 minutes; ties go to the nearest start.
- No proposal when the session already has the event's title, or when the
  owner said "not this one" for that session and event before.
- `library_calendar_matches` returns the proposals; it reads manifests off
  the library actor.

### P3 Answer

- "É essa reunião" (`library_resolve_calendar_match`, accept): the session
  takes the event's title, start and end, and the invitees are added to the
  participants already there (deduplicated by e-mail, then name). The list
  then links session and event as for any planned meeting.
- "Não é": the pair is remembered in `calendar-matches.json` in the app data
  directory and never proposed again.

### P4 Where it asks

- Reuniões shows "N gravações parecem reuniões da sua agenda" with
  "Revisar" while there are proposals. The sheet lists each recording with
  its date and length next to the event's title, time and invitee count,
  with the two answers.
- The list refreshes the proposals when the calendar cache changes.

## Acceptance

- [x] Overlap rule, minimum length, cancelled/all-day events, already named
      sessions and dismissed pairs (`calendar_match` tests).
- [x] Invitees merge into existing participants without duplicates
      (`calendar_match` tests).
- [ ] Accepting retitles and sets the time; declining is remembered
      (verified on the owner's library; the commands need a running app).
- [x] The banner appears with proposals, the sheet answers both ways and the
      list refreshes (`MeetingsHub` tests).
- [ ] Owner's library: the recordings of 26–30/10 are offered against the
      calendar.
