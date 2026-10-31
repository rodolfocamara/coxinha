# ADR-0023: Opt-in automatic recording of detected calls

- Date: 2026-10-31
- Status: Accepted (requested by the owner on 2026-10-31 with spec 0097)

## Context

Specs 0083, 0086 and 0087 and ADR 0021 (item 7) say that detecting a call
never starts a capture: the user clicks Record for every call, and the end of
a call is only a suggestion to stop. The owner forgets to click, and asked for
a setting that records detected Teams calls automatically and stops when the
call ends.

The detector watches audio stream metadata (Pulse/PipeWire on Linux), not
meeting identities. A call episode starts after two consecutive observations
and ends after four successful absent observations (about 12 s).

## Decision

A persisted, visible, default-off setting, **Gravar chamadas
automaticamente**, counts as the user's standing consent to record every
call episode the detector reports while the setting is on. A second setting,
**Parar quando a chamada terminar** (on by default once auto-record is on),
enables automatic stop.

1. The backend runs the policy next to the detector, so it works with the
   window hidden in the tray. The webview is not in the loop.
2. Auto-start happens only when no capture and no processing job is running.
   During another capture, a new call stays a prompt (spec 0087), unless the
   bound call already ended and its stop is pending. In that case the old
   capture stops and the new one starts (back-to-back calls).
3. Each auto-started capture is bound to its episode (pid and process). Only
   the end of that episode can stop it automatically: debounced absence plus
   a 20 s grace (spec 0087). Evidence returning or a failed poll cancels the
   countdown. Manual stop, pause, or a switch to another meeting clears the
   binding. A paused capture still stops when its call ends.
4. Every automatic start and stop is visible. A native notification names
   the app and the meeting, the strip shows REC, and during the grace it
   shows a countdown with **Continuar gravando** and **Parar agora**.
5. If an Outlook event from the local cache overlaps the call, the session
   takes the event's title, times and invitees. A planned session for that
   event is reused. Otherwise the title is "Reunião no {app}". Nothing is
   fetched over the network for this.
6. Turning detection off turns auto-record off.

This amends spec 0083 (non-goals "Automatic recording" and "automatic stop"),
spec 0086 (detection never starts capture), spec 0087 ("automatic consent for
a new call") and ADR 0021 item 7. These still apply whenever the setting is
off.

## Consequences

- **+** Calls get recorded without a click, including with the window hidden.
- **+** The end of a call stops the capture without the user coming back to
  the app.
- **−** Recording other people is the user's legal responsibility (LGPD).
  The setting's description tells the user to inform participants, and
  every capture is announced locally.
- **−** A false episode records non-call audio (for example a lobby or a
  device test). It stays as a normal recording the user can delete.
- **−** A false ending stops a capture early. The grace and the countdown
  are there to reduce it. Real Teams acceptance is still pending (spec
  0083).
