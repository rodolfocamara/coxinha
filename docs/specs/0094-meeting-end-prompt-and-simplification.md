# 0094 — Meeting end/boundary prompt, focus bring-up and UI simplification

Status: in-progress
Phase: Desktop usability
Date: 2026-10-29

## Why

When recording a meeting, forgetting to stop capture after the call ends can
cause subsequent calls to be recorded into the same audio track. Additionally,
the note actions menu carries 12 permanently disabled stub rows from an early
mockup, and Outlook connection controls live only on a separate `/agenda` route
instead of directly inside the `/calendar` view.

## Behavior (acceptance)

- Track the detected call episode (`trackedCall`) that authorized direct capture,
  or adopt the single active call episode while recording is active.
- When the tracked call episode disappears from `call_detection_status` while
  recording is still active, surface an explicit meeting-ended prompt
  (`callEndedPrompt`) and bring the main Coxinha window to the foreground
  (`show`, `unminimize`, `setFocus`, `requestUserAttention`).
- The meeting-ended prompt offers two explicit actions:
  - **Stop and save**: stops and finalizes the current recording (`library.stop()`).
  - **Keep recording**: dismisses the end prompt for that episode without
    stopping capture.
- When a new call episode appears while recording is already active (or after a
  previous call ended while still recording), surface a back-to-back boundary
  prompt (`nextCallPrompt`) and focus the window, offering:
  - **Start new meeting**: stops and saves the previous recording, creates a new
    session for the newly detected call, and starts recording it with default
    devices in a single explicit action.
  - **Same meeting (keep recording)**: dismisses the prompt for that call key
    and continues the current recording.
  - **Stop and save**: stops and finalizes the current recording.
- Simplify `NoteActionsMenu` by removing the 12 permanently disabled stub rows
  (_Move to, Archive, Present, Available offline, Customize page, Lock page,
  Use with AI, Suggest edits, Translate, Import, Export, Version history_) while
  preserving all functional actions (_Font picker, Copy link, Copy contents,
  Duplicate, Move to trash, Small text, Full width, Undo_, search filter, and
  word-count footer).
- Embed an expandable Outlook connection/sync panel directly inside `/calendar`
  (`CalendarView`) so the user can configure, connect, or sync Outlook without
  leaving the Calendar page, while keeping `/agenda` working for backward
  compatibility.
