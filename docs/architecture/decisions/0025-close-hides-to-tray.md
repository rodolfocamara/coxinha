# ADR-0025: Closing the window hides Coxinha to the tray

- Date: 2026-11-08
- Status: Accepted (requested by the owner on 2026-11-08 after the window's close
  button ended the app twice and meetings went unrecorded)
- Supersedes: the "not minimize-to-tray" sentence of ADR 0020 and the close-to-tray
  non-goal of spec 0074.

## Context

ADR 0020 made window close and tray Quit share one save-and-exit protocol. In daily
use the close button is pressed to get the window out of the way, not to stop the
recorder. A clean exit is final: the user service only restarts on failure, so the
app stayed closed for days and missed calls. The project invariant already says
"Tray-resident. Closing the window hides it".

## Decision

1. Closing the main window (close button, Alt+F4, the compositor's close) hides it.
   Capture, call detection, calendar refresh and processing keep running.
2. Only tray Quit runs the ADR 0020 save-and-exit protocol. Its guarantees
   (durable flush, recovery dialog, raw preservation, explicit discard) are unchanged.
3. While that protocol is running, a close request is ignored, so the recovery
   dialog stays visible.
4. The first hide in each run shows a notification saying Coxinha is still running
   and that Quit in the tray menu exits.
5. A second launch shows the running instance instead of starting another one.

## Consequences

- No routine data loss path changes: hiding writes nothing and stops nothing.
- On desktops without a tray, the window comes back through the global
  "open Coxinha" shortcut, the autostart entry or a second launch.
- Logging out or shutting down the OS still ends the process; that path is unchanged.
