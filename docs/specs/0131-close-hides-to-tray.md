# 0131 — Close hides to the tray

Status: in-progress
Phase: F1
Date: 2026-11-08

## Why

The window's close button ended Coxinha, and a clean exit is never restarted. The
owner closed the window to tidy the screen and the recorder stayed off for days.
ADR 0025 makes close hide the window; only tray Quit exits.

## Non-goals

- Changing the save-and-exit protocol of ADR 0020 / spec 0074.
- A setting to choose between hide and exit.
- Showing the app when the OS has no tray (the global open shortcut covers it).

## Design

- `CloseRequested` on the main window is prevented. If a shutdown is in progress
  the request is ignored; otherwise the window hides.
- The first hide in a run sends one native notification ("Coxinha is still running"
  / "Use Quit in the tray menu to exit."). Later hides are silent.
- `tauri-plugin-single-instance` is registered first; a second launch calls
  `show_main` on the running instance and exits.
- Tray Quit keeps calling `desktop::request_exit`.

## Acceptance

1. Closing the window hides it and the process keeps running. (unit: close decision;
   manual: Linux and Windows)
2. A close during a running shutdown does nothing. (unit)
3. Only the first hide of a run notifies. (unit)
4. Tray Quit still runs the save-and-exit protocol and records `exit_complete`.
   (existing desktop protocol tests; manual)
5. Launching Coxinha again while it is hidden shows the window, with one process.
   (manual: Windows)
