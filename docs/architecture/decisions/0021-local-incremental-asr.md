# ADR-0021: Separate durable capture from local incremental inference

- Date: 2026-10-26
- Status: Accepted (product direction authorized 2026-10-26; implementation gates pending)

## Context

The user requests clear processing status, recoverable meeting boundaries and
local transcription during calls. Current core inference normalizes a full track
and invokes Whisper with GPU disabled. The library excludes concurrent capture
and processing; removing that guard alone cannot establish capture safety.

Installed Handy metadata describes a Tagarela Parakeet GGUF converted to the
`transcribe.cpp 0.2.4` schema. The model cannot be loaded by the existing Whisper
adapter or by ONNX Runtime simply because its file is local.

## Decision

Use durable audio checkpoints plus a bounded local inference queue, initially
evaluating Tagarela in short windows and keeping native streaming pluggable.

1. The capture writer owns raw audio and its clock. Inference consumes committed
   ranges, never owns the recorder or blocks its writes. A migration proposal must
   define chunk publication, manifests and recovery without breaking existing raw
   hashes, playback, import or session-note links.
2. Derived jobs are identified by capture/range revision, model/runtime hash and
   configuration. Publish results and their cursor atomically; reconcile retries
   without duplicated text. Keep original and human-edited transcript revisions.
3. Keep ASR timestamps independent of diarization/recognition. Speaker estimates
   remain provisional until confirmed. Do not automatically enroll voice samples.
4. Use explicit model capabilities: batch/windowed, stateful streaming, timestamps,
   language selection, device support and cancellation. Do not fabricate methods
   for an engine that lacks them. Model hashes alone do not prove runtime parity.
5. Prefer a native Rust adapter or native binding, consistent with ADR 0004. Assess
   the Handy-compatible GGUF path first because it preserves the user's preferred
   weights. If ONNX is selected under ADR 0010, validate an exact corresponding
   export separately; ONNX and GGUF results are not interchangeable evidence.
   Do not introduce a Python runtime or supersede ADR 0010 implicitly.
6. Enforce one inference scheduler with capture priority, bounded memory and
   checkpointed cancellation. Heavy post-processing yields while recording.
   All status comes from actual workers; no progress based on elapsed timers.
7. Treat session splits/joins as versioned range mappings over immutable captures.
   Their metadata/notes/activity migrations require tests and a separate schema
   proposal before implementation. New call detection does not grant recording
   consent or reliably identify a Teams meeting.
8. No captured content leaves the computer. No remote fallback or online text
   enhancement. Model acquisition is an explicit provisioning step outside calls.
9. Handy remains independent and usable during calls. Shared read-only model files
   do not imply shared runtime memory. Coxinha limits its own resource consumption
   and yields inference before sacrificing capture; no cross-app lock or shared
   server is introduced. Real simultaneous-use acceptance is a separate gate.

## Alternatives and consequences

| Choice | Benefit | Cost / reason not to make it the default yet |
| --- | --- | --- |
| Post-call batch | Simple; maximum uninterrupted context | Long invisible backlog unless spec 0088 is implemented |
| Short windows | Reuses preferred Tagarela; useful text during calls | Context seams, overlap recomputation and provisional text |
| Native streaming | Cached state; potentially lower latency and compute | Different model/runtime; PT-BR quality and integration unmeasured |
| Cloud streaming | Managed infrastructure | Violates the requested local-only boundary |

Recommend near-real-time as the first product target, not a permanent restriction
on the ASR architecture. Benchmark Nemotron 3.5 alongside Tagarela before locking
the runtime. No claim that subsecond streaming necessarily costs more resources.

Specifications: [0087](../../specs/0087-meeting-boundaries-and-reversible-sessions.md),
[0088](../../specs/0088-visible-local-processing.md),
[0089](../../specs/0089-local-incremental-transcription.md).
