# ADR-0026: Windows capture through WASAPI, with followed defaults and absent tracks

- Date: 2026-11-08
- Status: Proposed (spec 0133)

## Context

The Linux adapter records two explicit PipeWire sources with `parec` and
never falls back to another device (spec 0007, ADR 0018). Windows needs the
same two raw tracks, but its devices behave differently:

- Users plug and unplug headsets during calls, and Windows moves the default
  endpoint with them. Teams follows the default; a recording pinned to the
  old endpoint would go silent or fail.
- Laptops in docks and VMs often have no microphone, and some machines have
  no render endpoint while a USB headset is unplugged.
- WASAPI loopback delivers no packets while nothing plays, which the Linux
  pump reads as a stalled source.

## Decision

1. Capture uses WASAPI shared mode with automatic format conversion to
   48 kHz mono 16-bit, polling every 10 ms, one thread per track. Loopback of
   a render endpoint gives computer audio; the same thread plays silence on
   that endpoint so loopback keeps a steady clock.
2. The source list offers the system default as its own entry per kind. A
   track recording a default follows it: on a default change or a lost
   device it reopens the new default and journals a `gap`. Explicit
   endpoints keep the Linux rule: no fallback, the capture stops as
   interrupted.
3. A track can be absent: chosen as `none` when the computer has no endpoint
   of that kind, or lost while following a default that no longer exists.
   An absent track is written as digital silence paced by the other track,
   with the reason journaled. Both tracks absent stops the capture.
4. The on-disk format, checkpoints, `recover_capture` and orphan
   reconciliation (ADR 0022) are shared with Linux unchanged.

## Consequences

- **+** A headset change mid-call keeps one recording with both tracks.
- **+** Machines with only speakers or only a microphone can record.
- **+** Processing, live transcript and recovery need no Windows branch.
- **−** Silence in `mic.wav` does not prove the owner was quiet; the journal
  and the `wasapi:none-input` source say the microphone was absent.
- **−** Following a default means the track's device can change within one
  file; the journal names each endpoint, but loudness and latency may jump at
  the switch.
- **−** The adapter plays a silent stream on the recorded endpoint while
  recording; it is inaudible but shows as a session in the Windows volume
  mixer.
