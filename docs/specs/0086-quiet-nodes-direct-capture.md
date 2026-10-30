# 0086 — Quiet activity nodes and direct recording consent

Status: done
Phase: Desktop usability

## Why

Area names repeat inside contained activities and a decorative grip adds an
unnecessary header. Detection currently sends the user through a recording page
after they have already agreed to record.

## Contract

- Remove the repeated parent name and grip from activity/free-text nodes. The
  card surface outside selectable/editor content and controls remains draggable.
  Resize, containment, completion, note identity and autosave remain unchanged.
- An explicit Yes, record click resolves current default microphone and output,
  creates a session and starts its recording without navigation. Merely detecting
  a call or reading devices/calendar never creates a session or starts capture.
- Single-flight capture and acknowledged session identity survive route remounts.
  A failed start retains the created session for an explicit retry. Recheck that
  detection is enabled and the episode still exists before starting. Backend
  capture exclusion and the existing global Stop control remain authoritative.
- Missing defaults or status errors fail visibly without guessing devices.
  Never repeat capture because session refresh or metadata copying fails.
- Optional details offer an editable title and an explicit choice among cached
  ongoing/nearby calendar invitations. No automatic time-based association, sync,
  OAuth, new permissions or network request. The chosen event supplies title and
  dates; invited people become private participant candidates after start, never
  confirmed attendance, speaker attribution or voice enrollment. Metadata failure
  does not stop or restart a successfully acknowledged recording.
- Removing the old requestedSession handoff eliminates navigation-only capture
  preparation. Existing session capture controls remain available.

## Limits and non-goals

The local process detector cannot identify the Teams meeting URL/title. Calendar
data requires the existing authorized Outlook connection and a populated cache.
Invitees are not attendance. No Graph presence/report integration in this change.
Session retry identity is process-local, not an exactly-once IPC protocol across
process failure. No schema, Rust, automatic capture, recognition or model changes.

## Validation

Test explicit consent, double click/remount, defaults, failure/retry without a
second session, late failure after successful start, ended calls, metadata scope
and retained global Stop. Test node dragging, resizing and containment in a real
browser. Build in an isolated snapshot and exercise consent/capture using private
Linux audio fixtures before updating the local launcher. No operator data/devices.

## Acceptance

627 frontend tests passed (3 pre-existing timezone skips); 70 focused tests passed
after the final geometry change, and 8 capture tests plus typecheck passed after
a test-only Source description correction. Browser checks at 1280/light and
800/dark proved surface drag, resize, containment, reload, direct consent, optional
calendar metadata and global Stop. A private Linux WebKitGTK/KWin/PipeWire run
proved no capture before consent, one session/meeting, two default-device tracks
with synthetic signal, Stop/save and normal flush/exit. No real Teams, Windows,
operator calendar/account/device or speaker attribution acceptance is claimed.
