# 0113 — Record a detected call into its calendar meeting

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

On 2026-11-03 the owner joined "Roadmap with Yehuda", confirmed the detected
call, and Coxinha recorded "Meeting in Google Chrome": a new session with no
calendar event, next to the session already prepared for that meeting. The
detected-call strip starts with no event chosen; linking needed opening
"Detalhes" and picking one. Nothing on the strip said which meeting the
recording would belong to.

## Non-goals

- Recording without the owner's click (spec 0097 keeps auto-record separate).
- Proving that a call is a given meeting. The time is a suggestion; the owner
  sees it and can change it before recording.

## Design

### P1 The likely meeting is chosen and shown

- When a call is detected, the strip reads the Outlook cache once and picks
  the calendar meeting around now (spec 0094's window: started, or starting
  within 15 minutes, and not over): one already under way first, then one
  with invitees over a personal block, then the nearest start.
- Beside "Gravar" the strip shows what it records into: "Roadmap with Yehuda
  · 09:00–10:00", or "Gravar sem reunião".

### P2 The arrow chooses

- "Gravar" is a split button. The arrow opens a menu with the meetings around
  now (title and time, the chosen one checked) and "Gravar sem reunião".
  Picking one changes the label; "Gravar" then records into it.
- "Detalhes" keeps the title field and the same choice.

### P3 The prepared session takes the recording

- Recording into an event uses the session already prepared from it (same
  title, start within 30 minutes, still planned and not recorded) instead of
  creating another one. Otherwise a session is created from the event, as
  before (title, time, invitees as participants).
- "Gravar a nova" for a back-to-back call picks the likely meeting the same
  way.

## Acceptance

- [x] Under way beats starting soon, invitees beat a personal block, nearest
      start breaks ties (`directCapture` tests).
- [x] The strip shows the likely meeting beside "Gravar"; the arrow lists the
      meetings and "Gravar sem reunião"; choosing solo records a new untimed
      session (`RecorderStrip` tests).
- [x] A prepared session for the event takes the recording; no new session
      is created (`directCapture` tests).
- [ ] Owner: a detected call during a calendar meeting records into it.
