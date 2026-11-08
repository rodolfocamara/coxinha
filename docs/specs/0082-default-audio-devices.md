# 0082 — Default audio devices

Status: implemented
Phase: Desktop capture

## Why

Linux correctly reports the operator's default microphone and output sink, but
capture selectors start empty and the app never queries the server defaults.

## Contract

- Query Pulse/PipeWire defaults and sink-to-monitor relationships during source
  enumeration. Resolve to actual enumerated device names, never magic aliases.
- Mark the default microphone and the monitor of the default output separately.
  Missing default metadata must not prevent manual device selection.
- Initially select those defaults in both session and legacy capture views.
  Refresh preserves valid manual choices; an explicit reset selects current
  system defaults. No automatic capture or device switching during recording.
- Refresh/reset are disabled while recording or processing an action. Show human
  descriptions and default badges rather than repeating technical IDs.
- Capture still validates explicit, distinct microphone/monitor names before
  creating files. No audio is recorded as part of device discovery.

## Non-goals

Teams API integration, automatic recording, changing OS defaults, Windows adapter,
mid-recording rerouting, and model/transcription changes.

## Validation

Fixture tests cover Pulse and PipeWire monitor JSON variants, separate defaults,
missing defaults, and manual selection preservation. UI tests verify defaults
reach the existing start IPC, explicit override and refresh/reset. Read-only
host enumeration checks the actual Focusrite defaults. No operator audio capture.

## Evidence

Default selection verified in private native WebKitGTK against the actual host
audio server without recording. 592 UI tests and 358 Rust tests passed; three UI
skips and two Rust ignored tests are pre-existing. See
`target/default-audio-20261025/REPORT.md`. Real Teams capture remains a user gate.
