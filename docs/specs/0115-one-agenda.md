# 0115 — One agenda: each meeting once, recordings at their real time

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

The owner's afternoon of 2026-11-03 showed four gaps:

- An unscheduled Teams call (in Chrome) ended at 15:00:12 UTC; the detector
  logged "call ended" nine seconds later, yet nothing reached the owner, who
  stopped by hand at 15:01:41. The only signal of the end is the strip
  prompt, which needs the window's own polling and focus. With the window
  hidden in the tray, or behind the call where the compositor refuses focus,
  it goes unseen. The start of a call already raises a native notification;
  the end did not.
- That call was recorded into "Lunch": the record target (spec 0113) assumed
  the event under way, and a personal block without invitees counts as one.
  Spec 0100 already ignores such blocks when offering a match.
- "Roadmap with Ana" shows twice. A session was prepared for the event
  (with links and files); the recording made before spec 0113 got its own
  session; confirming "É essa reunião" renamed and re-timed that session but
  left the prepared one next to it.
- A recording outside the calendar ("Meeting in Google Chrome") sits on the
  agenda as a 30-minute block at its start, whatever its length, because its
  session has no time.

## Non-goals

- Silence detection in the backend. The silence prompt of spec 0114 still
  runs in the window.
- Joining two sessions that both hold the owner's notes or files. Those stay
  side by side.
- Writing local meetings to Outlook. The agenda composes both sources.

## Design

### P1 The end of a call reaches the owner natively

- While a capture runs, the detector poll in which the last active call
  closes raises a native notification ("A chamada terminou?" / "O {app}
  encerrou a chamada e o Coxinha continua gravando. Abra para parar ou
  continuar.") and brings the main window up, where the strip prompt waits.
- On Linux the notice carries critical urgency, so Do Not Disturb (often
  left on during calls) still shows it. The main window also requests
  attention, because Wayland compositors refuse focus from the background.
- Nothing is raised while another call is still active, without a capture,
  or when automatic recording will stop this call itself (spec 0097).

### P2 Personal blocks are never assumed

- Neither the record target nor automatic recording assumes an event
  without invitees. The owner can still pick it from the target menu.

### P3 A confirmed recording joins the prepared session

- Confirming a calendar match moves the recording into the session prepared
  for that event (same title, start within 30 minutes, no recording yet) and
  retires the recording's own session, in one transaction. The peek then
  shows the prepared session.
- The recording's session is retired only when nothing of the owner hangs on
  it: its note is empty (no letter or digit after the frontmatter), it has no
  item folder and no other note names it. Its empty note goes to the trash.
- Recordings confirmed before this spec are joined the same way when the
  calendar reads its matches.

### P4 Unscheduled recordings at their real time

- When a capture finishes, a session without a scheduled time takes the
  recording's span: from the meeting's creation to the stop. A scheduled time
  is never replaced.
- Recordings closed before this spec take their span (start plus the longest
  track) when the calendar reads its matches.

## Acceptance

- [x] The last call closing during a capture asks natively; another active
      call, no capture or an automatic stop keep quiet
      (`call_detector` `only_the_last_call_closing_during_a_capture_asks_to_stop`).
- [x] A block without invitees is never the default target or the
      auto-record event (`directCapture` test, `plan_tests`).
- [x] Absorbing moves the recording and retires the duplicate; a kept
      session with a recording is never overwritten
      (`session::tests::absorbing_moves_the_recording_and_retires_the_duplicate`).
- [x] A session with text in its note, an item folder or a mention elsewhere
      is kept (`absorb` tests).
- [x] The peek follows the prepared session after "É essa reunião"
      (`MeetingsHub.match.test.tsx`).
- [x] An unscheduled recording takes its real span once
      (`session::tests::an_unscheduled_recording_takes_its_real_span_once`).
- [ ] Owner: a Teams call ending with Coxinha hidden raises the
      notification; "Roadmap with Ana" shows once.
