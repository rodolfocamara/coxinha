# 0114 — Notice when a detected call ends

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

On 2026-11-03 the owner left a Google Meet call and Coxinha kept recording
without asking. Call detection (spec 0097) only looks at which apps hold
audio streams: a browser call is "on" while the browser has an open
microphone stream and a playback stream. A browser may keep its microphone
stream after the meeting (the "you left" page, a tab left open), so the
streams never close and nothing marks the end. The detector also logged
nothing, so the evening could not be reconstructed.

## Non-goals

- Reading window titles, URLs or audio content to identify a meeting.
- Stopping by itself. Automatic stop stays the opt-in of spec 0097.

## Design

### P1 Silence is a second sign

- While a recording started from a detected call is live and not paused,
  the strip watches the output track's level (already polled for the
  meters). Two minutes with nothing above the noise floor on the other side
  shows the same prompt as a closed call: "Ninguém fala na chamada do Google
  Chrome há 2 minutos. Ela terminou?" with "Parar e salvar" and "Continuar
  gravando".
- Any sound restarts the clock; "Continuar gravando" waits another two
  minutes. With automatic stop bound to the call, the backend countdown
  stays in charge.

### P2 The detector says what it saw

- The detector logs "call detected" and "call ended" with the app label,
  process id and whether it is a browser. Nothing else: no titles, URLs or
  stream names.

## Acceptance

- [x] Two minutes of output silence while the call is still detected asks;
      sound restarts the clock; "Continuar gravando" waits again; a paused
      capture or a recording not started from a call never asks; closed
      streams still say the call ended (`callSilence` tests).
- [x] The strip shows the silence wording (`RecorderStrip` tests).
- [ ] Owner: leaving a Meet call is noticed within about two minutes, and
      the log shows the call's start and end.
