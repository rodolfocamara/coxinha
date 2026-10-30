# 0093 — Sidebar live recording pill and unified status

Status: in-progress
Phase: Desktop usability
Date: 2026-10-29

## Why

Global recording status and direct-capture confirmation currently stack as two
plain full-width banners above the canvas, pushing content down and duplicating
session context. Modern desktop recorders (Amie, Granola, Otter) anchor a tactile
live recording card in the navigation rail, highlight the active session row in
place, and fall back to a compact top status pill only when the rail is collapsed.

## Behavior (acceptance)

- Render the global `RecordingStatus` card inside the main navigation sidebar
  (above `MEETING SESSIONS`) when the sidebar is expanded, and render a compact
  status pill bar in the content column when the sidebar is collapsed.
- The recording card displays a live pulsing indicator (or amber paused dot),
  a `tabular-nums` timer (`MM:SS`), live mic/output reactivity bars, the active
  session title (from direct-capture receipt or loaded session list) with a
  direct link to that session when known, a link to the meeting library, and
  inline `Pause`/`Resume` and `Stop and save` controls.
- Unify the post-consent `Recording started: <title>` receipt with the live
  recording status when capture is active so only one recording bar/card is
  shown. Preserve `Dismiss notice`, `Open meeting` (`/sessions/$sessionId`),
  and the `role="alert"` warning when participant metadata copy fails. If
  `RecordingStatus` is not active (or mocked in isolated unit tests),
  `MeetingReminder` continues to render the receipt fallback.
- Highlight the currently recording session in `SessionList` with a live `REC`
  badge and subtle accent border so the user can spot the active meeting in the
  sidebar list at a glance.
- Preserve sequential non-overlapping status polling, single-flight `Stop` and
  `Pause` guards, error recovery alerts, and independent background processing
  phase indicators (`validation`, `inference`, `stopping`).
- Keep full keyboard accessibility, screen-reader landmarks/roles, and
  English + `pt-BR` localization.

## References

- Amie desktop recorder pill & sidebar indicator
- Granola live note recording pill & reactive waveform
- Otter / Linear compact dark-mode sidebar status cards
