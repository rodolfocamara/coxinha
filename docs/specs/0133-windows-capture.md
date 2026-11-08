# 0133 — Record meetings on Windows

Status: in-progress
Phase: F1
Date: 2026-11-08

## Why

Linux and Windows are both primary targets, but capture only exists on
Linux (PipeWire through `parec`). On Windows `library_sources` and
`library_start` answer "capture adapter unavailable on this platform", so the
recorder, the live transcript and processing never see a Windows meeting.
Specs 0096 and 0097 declared Windows capture out of scope until an adapter
existed.

## Non-goals

- Call detection on Windows. `call_detector` only has a Linux backend, so
  automatic recording (spec 0097) and stopping with the call (spec 0118) stay
  Linux-only. Manual recording from the strip, the shortcut or the calendar
  works.
- Per-process loopback (only the Teams process). The default render endpoint
  carries everything the computer plays.
- macOS.
- The recorder's "unsupported" state and start-failure handling in the
  webview (separate work).

## Design

See [ADR 0026](../architecture/decisions/0026-windows-wasapi-capture.md).

### P1 Devices

- `library_sources` lists WASAPI endpoints with the same `Source` shape as
  Linux. Microphones are capture endpoints (`monitor: false`); computer audio
  is the loopback of a render endpoint (`monitor: true`).
- The first entry of each kind is the system default, named
  `wasapi:default-input` / `wasapi:default-output`, `is_default: true`,
  described with the current default endpoint's friendly name. It follows the
  default while recording (P3).
- Every other active endpoint is listed as `wasapi:<endpoint id>`. An explicit
  endpoint is never replaced by another one.
- No active capture endpoint: the only microphone entry is
  `wasapi:none-input` ("No microphone", `absent: true`, default). No active
  render endpoint: `wasapi:none-output` likewise. The recording keeps
  computer audio only, or the microphone only.
- No endpoint at all: `library_sources` fails with "no active audio input or
  output on this computer".
- `absent` is omitted from the JSON when false, so the Linux payload is
  unchanged.

### P2 Same files as Linux

- `raw/<meeting>/mic.wav` and `output.wav`: 48 kHz, mono, 16-bit PCM, written
  in 20 ms blocks (960 samples), with `timing.jsonl` and `manifest.json`
  through the shared `Recording`. Checkpoints every second, orphan
  reconciliation (ADR 0022) and `recover_capture` are the same code.
- WASAPI shared mode with automatic format conversion delivers 48 kHz mono
  16-bit; the adapter does no resampling of its own.
- Silent loopback still produces samples: the adapter plays silence on the
  render endpoint it records, because WASAPI loopback delivers no packets
  while nothing plays. Without it a quiet call would look like a stalled
  source.
- An absent track is written as digital silence, one block for each block of
  the other track with the same arrival time, so both files stay aligned and
  processing reads two tracks as on Linux. The journal records why (`gap`
  events naming the absent source); the manifest names the `wasapi:none-*`
  source.

### P3 Device changes

- A track recording a default entry checks the default endpoint every second
  and reopens it when it changes or when the stream reports the device gone
  (headset plugged or unplugged mid-call). The switch is a `gap` event in
  the journal naming the new endpoint; recorded audio is kept.
- If no default endpoint remains for that kind, the track becomes absent
  (silence, P2) and is reopened when one appears. If both tracks are absent
  at once, the capture stops as interrupted.
- A track recording an explicit endpoint fails when that endpoint goes away:
  the capture stops as `interrupted`, raw audio preserved, as Linux does for
  a source that ends.
- A present track that delivers nothing for two seconds stops the capture as
  interrupted, as on Linux.

### P4 Linux untouched

- The Windows adapter and source listing are compiled only on Windows; the
  platform-neutral parts (source list building, block framing, the pump with
  absent tracks) are compiled everywhere so Linux CI tests them.
- The Linux adapter (`PulseCapture`, `sources.rs`) does not change.

## Acceptance criteria

- [ ] Default entries first, explicit endpoints after, no duplicate of the
  default, `none` entries only when a kind has no endpoint, an error when
  there is none at all. (`capture::endpoints` tests)
- [ ] Packets of any size become 960-sample blocks in order; the tail under
  20 ms is not kept. (`endpoints` framing tests)
- [ ] With the microphone absent, every output block writes a silent mic
  block with the same arrival; the capture finishes as `finished` with
  equal frame counts. (`endpoint_capture` tests)
- [ ] A default switch is journaled as a gap and keeps recording; a track
  lost then found again fills silence meanwhile; both absent stops as
  interrupted; a stalled present track stops as interrupted.
  (`endpoint_capture` tests)
- [ ] An interrupted Windows capture is recovered by the shared
  `recover_capture` path. (`endpoint_capture` tests)
- [ ] The Linux `Source` JSON has no `absent` field. (`sources` tests)
- [ ] `cargo check --target x86_64-pc-windows-msvc` and the Windows release
  workflow build.
- [ ] Windows 11 VM with speakers and no microphone: record text-to-speech
  played on the speakers, stop, and the transcript appears.
- [ ] Owner: a Teams call on Windows with a headset, unplugging it mid-call.
