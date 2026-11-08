# 0083 — Local meeting detection

Status: implemented (real-call acceptance pending)
Phase: Desktop capture

## Why

The installed Linux app does not detect calls: the legacy detector returns an
empty list. A user joining Teams must remember to open capture manually.

## Contract

- Linux polls Pulse/PipeWire stream metadata every three seconds. No audio
  samples, window titles, browser URLs, calendar access, or network requests.
- Recognized calling apps using microphone input are candidates. Output-only
  candidates require communications/WebRTC metadata (including muted calls).
- Browsers require WebRTC/phone metadata or simultaneous input/output from the
  same process. They are labelled by browser, never falsely identified as Teams.
  Lobby, device checks and dictation can still produce a possible-call hint.
- Two consecutive observations establish an episode. Four successful absent
  observations end it. Errors preserve episode identity and are reported; they
  never cause a new notification. A later call in the same process can notify.
- One desktop notification per episode plus a persistent, dismissible in-app
  reminder. No focus stealing and no recording on detection. A user action opens
  a preparation dialog to select an existing session or create a new one, then
  navigates to its recording controls. Capture still requires explicit Start.
- A local persisted Settings toggle controls detection. Default on per user
  request, activated only by the frontend setting; browser preview never polls.
  Disable cancels publication of in-flight observations. Unsupported platforms
  explicitly report unsupported rather than claim detection.
- Calls already being recorded do not show an in-app reminder. Native
  notifications are metadata-only reminders, not an assertion of capture state.
- Poll commands have bounded stdout and deadlines, kill/reap on timeout. Shutdown
  cancels the detector before process exit; detection creates no durable records.

## Non-goals

Automatic recording, bots, Teams/Graph integration, automatic calendar matching,
participant identification, automatic stop, and Windows detection implementation.

## Validation

Synthetic Pulse metadata, lifecycle debounce/error/reentry tests; frontend
settings/dismissal/explicit prepare tests; private native Pulse server and
notification service. Real Teams/web-client acceptance remains separate.

## References

Fireflies desktop detects a call then offers a recording action:
https://guide.fireflies.ai/articles/6666374717-how-to-record-meetings-without-a-bot-on-the-fireflies-desktop-app
Pulse stream metadata keys:
https://www.freedesktop.org/software/pulseaudio/doxygen/proplist_8h.html
