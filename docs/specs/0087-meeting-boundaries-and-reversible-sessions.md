# 0087 — Meeting boundaries and reversible sessions

Status: in-progress
Phase: F1
Date: 2026-10-26

## Why

Successive calls currently become one recording if the user forgets Stop.
The Linux detector observes application audio streams, not a Teams meeting ID.
Recording must have a visible lifetime and uncertain boundaries must be repairable.

## Non-goals

No always-listening microphone, automatic consent for a new call, cloud analysis,
destructive audio editing, speaker enrollment, or retrospective modification of
the operator's existing recordings. Calendar times and invitees are not proof of
actual participation. External provider events are an optional future adapter.

## Behavior (acceptance)

- Persist the acknowledged capture/session identity and its originating detector
  episode when the user accepts recording. A detected process or global recording
  flag alone never establishes ownership. Manual captures have no invented episode.
- During recording, retain global Stop and add an explicit New meeting action.
  A possible different call must remain visible even while another is recording.
- Present an end suggestion when the bound episode disappears across successful
  observations. The initial proposed grace is 20 seconds after debounced absence,
  with Keep recording and Stop and save. The UI explains that it is an estimate.
  Automatic stopping requires a visible user-enabled setting; otherwise this is
  a suggestion only. Timings are tuning candidates, not proven detection accuracy.
- Polling errors, sleep/resume, device changes, mute, loss of one track and short
  reconnects cannot independently count as a confirmed call ending. Cancel any
  absence countdown when evidence returns or becomes unreliable.
- Silence and farewell phrases may contribute a boundary suggestion only within
  already-authorized audio. They never independently stop, split or start capture.
  No ASR/LLM is required for the basic process-event detector.
- A new stable episode while recording offers New meeting / Same meeting / Stop.
  New meeting explicitly authorizes the new recording, checkpoints the previous
  session, and binds new audio to a new session. Repeated clicks and late events
  cannot duplicate either session or redirect an acknowledged capture.
- When the same application continuously retains streams across two calls, show
  the detection limitation and keep manual split available. Do not claim reliable
  Teams identity from PID, silence, calendar overlap or a guessed meeting title.
- Recording ends at the acknowledged stop, not at an inferred past timestamp.
  Never retain an invisible rolling buffer after Stop or restart automatically.
  Audio already captured during an authorized grace period remains reviewable.

## Reversible split and join

- A split creates logical session ranges over immutable raw tracks. Preserve the
  original capture, hashes, timeline offsets, gaps and both microphone/output tracks.
  Preview the boundary before applying; permit adjustment and undo.
- Joining references ordered ranges, including discontinuities, rather than
  concatenating/deleting originals. A new derived view cannot erase prior sessions.
- Boundary changes are versioned and atomic. A crash/retry cannot orphan audio,
  publish half a split, duplicate jobs or delete user notes. Garbage collection is
  outside this feature and requires independent retention rules.
- Show the destination of notes, confirmed speaker assignments and activity links
  before applying a split/join. Preserve original references; never silently copy
  a confirmed identity to unrelated audio or move an accepted task's source.
- Derived transcripts keep capture/track/sample-range provenance. Crossing segments
  are flagged for reconciliation; old human edits remain recoverable and are not
  silently overwritten by retranscription. Pending jobs reject obsolete revisions.

## Design notes

Extend `call_detector/episodes`, the direct-capture acknowledgement flow and the
library's session/capture lifecycle. A durable range manifest and migration design
must precede implementation; this document does not prescribe an unsafe overwrite
of today's one-session/one-meeting relationship. See ADR 0021 and specs 0088–0089.

## Validation

Use synthetic two-call timelines: same PID with and without a stream gap, different
PIDs, simultaneous apps, mute, long silence, device switch, failed polls, reconnect,
sleep, quit, stop failure and restart. Verify no recording without explicit consent.
Crash each split/join publication step and verify raw hashes, timeline coverage,
idempotency, edits, task links and undo. Native Linux/Teams and Windows acceptance
must be reported separately from mocked events. No such acceptance exists yet.

## References and open decisions

- [Otter desktop](https://help.otter.ai/hc/en-us/articles/35973988280215-Otter-Desktop-App-Mac-Windows)
  documents end detection and a Keep recording escape hatch.
- [Wispr Notetaker](https://docs.wisprflow.ai/articles/9319084321-Notetaker-settings,-explained)
  documents end detection and reconnection handling. Neither documents a portable
  Linux algorithm we can assume works in Coxinha.
- Initial product decision: begin with suggestions; validate false endings before
  enabling automatic stop. Range-manifest schema and note disposition need a
  concrete implementation proposal, not a user decision about internal IDs.

Implementation authorized on 2026-10-26. End suggestions and manual New meeting
can precede range-manifest migration; do not claim split/join complete until the
raw-preservation, reference-disposition and crash-recovery gates above pass.
