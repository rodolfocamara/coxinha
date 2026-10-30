# 0089 — Local incremental transcription

Status: in-progress
Phase: F1
Date: 2026-10-26

## Why

Transcription should arrive during a meeting and leave a small backlog after Stop,
without sending audio, text, embeddings or summaries off the computer. The user
prefers their installed Tagarela model for Brazilian Portuguese.

## Non-goals

No remote ASR/LLM fallback, mandatory cloud account, automatic model downloads,
Handy history import, automatic voice enrollment or guaranteed subsecond captions.
This draft does not enable concurrent processing in the current application.

## Product behavior

- Start with near-real-time transcription using short bounded audio windows.
  Show stable text plus a clearly provisional tail; do not present unstable partial
  text as final evidence for tasks or confirmed speaker identity.
- Initial tuning experiment: dispatch at speech pauses or approximately 5–10
  seconds of speech, force a bounded window by 20 seconds, and test limited context
  overlap. These are starting parameters, not measured latency promises. Measure
  speech-to-display and end-of-utterance-to-stable-text separately.
- Persist the original two tracks independently of inference. Consume committed
  chunks or stable checkpoint ranges, not an unbounded in-memory stream or an
  unfinished WAV interpreted as complete. No audio loss when inference is slower.
- Timestamp text against the original capture/sample clock, not job start time.
  Reconcile repeated overlap deterministically; preserve gaps and concurrent speech.
  Reset model context at confirmed meeting boundaries, never carry names or text
  from a previous call into the next call's decoding context.
- At Stop, drain the remaining queue and finalize text. Diarization and optional
  local summaries have independent status. A whole-recording second ASR pass is
  optional and explicit, not a mandatory hidden duplicate GPU workload.
- Human corrections and confirmed people survive reconciliation. Publish derived
  revisions transactionally and reject stale results after split/join or edits.

## Models and language profiles

| Profile | Initial candidate | Required evidence |
| --- | --- | --- |
| Brazilian Portuguese | Installed Tagarela Q8 GGUF | Exact converted-runtime compatibility; PT-BR meeting quality |
| English | Original Parakeet V3; optionally V2 baseline | English quality and latency on this host |
| Mixed PT/EN | Original multilingual V3 | Intra-sentence code switching and language-drift evaluation |
| Native streaming challenger | Nemotron 3.5 ASR streaming 0.6B | Local compatible runtime, PT-BR/EN quality, two-track resource use |
| Existing fallback baseline | Local Whisper | Current CPU implementation; GPU only if actually enabled/tested |

- Profiles select a model/configuration; they must not invent a language-forcing
  parameter that a runtime does not support. Parakeet TDT V3 automatically detects
  language. Selecting Portuguese primarily chooses Tagarela, not a nonexistent
  TDT language prompt. Mixed-language quality is unproven on this machine.
- Start with an explicit per-meeting profile and a remembered default. Do not swap
  large models at every word or infer language from a Portuguese-specialized model
  as though it were an independent language detector. A profile switch has a visible
  effective boundary and preserves already-produced text and queued audio.
- Register existing model files read-only with hash, provenance, license, format,
  tokenizer, preprocessing and runtime version. Never rename, overwrite or convert
  the user's Handy installation in place. Unsupported files fail before capture
  processing; recording itself remains available.
- One ASR model resident by default; load/unload changes are visible. CPU-first is
  a benchmark candidate, not a performance promise. Test GPU acceleration only in
  runtimes that support this model and build. No silent cloud fallback on OOM.

## Concurrent Handy use

- The user must remain able to dictate through Handy during a Coxinha recording.
  Sharing a read-only model file does not share inference state or guarantee a
  single memory allocation. Account for both processes and conferencing together.
- Coxinha never locks, changes, suspends or terminates Handy or its model files.
  No shared inference daemon or modification of Handy is required in this scope.
- Limit Coxinha worker concurrency and CPU threads explicitly. Admit GPU work only
  with a bounded allocation policy; never infer available memory from total VRAM.
  Conservative defaults and resource settings must be visible and persisted.
- Under pressure, defer Coxinha inference and expose its backlog. Keep recording,
  Stop, notes and UI responsive. Provide Pause transcription independently of Stop.
  Do not claim automatic priority over Handy without an observable scheduling
  mechanism; a live CPU/GPU pause or unload may require a cooperative boundary.
- Validate repeated short Handy-style dictation jobs during a two-track call,
  cold model loads, simultaneous model residency and sustained thermal load.
  Synthetic inference contention precedes an explicitly controlled real Handy
  acceptance run; do not read its history or record operator audio for this test.

## Resource and privacy contract

- The first reader increment reuses version-1 recorder checkpoints: a pinned
  manifest declares durable PCM frame limits; reads use the recorder's fixed
  44-byte PCM16 header offset and never a changing WAV header. Pin an independent
  read descriptor and cap each request at 30 seconds plus 48 context frames on
  each side. Reject unsupported/imported layouts, invalid paths, overflowing or
  out-of-checkpoint ranges and truncated files before publication. Refresh requires
  a new manifest snapshot. Do not treat this reader as final checksum verification.
- Test against the real recorder: uncheckpointed tails remain invisible, changing
  header bytes do not alter sample reads, recovery preserves the exposed prefix,
  and concurrent appends do not change a pinned range. No raw-format migration is
  needed for this increment. Imported WAVs require their own validated seek reader.

- Capture, UI, autosave and Stop have priority over inference. Use bounded queues,
  cooperative checkpoints and explicit backlog. Retain today's mutual exclusion
  until synthetic/native tests prove a safe replacement scheduler.
- Cancellation request, stopped computation and thread join are different states.
  A timeout cannot declare the engine stopped, release an exclusive compute slot,
  or start another worker. Do not silently bypass the capture/inference guard on
  timeout; expose a recoverable condition until preemption or isolation is proven.
- The first cancellation increment adds a shared monotonic token and typed abort
  result to the core execution boundary. Check before/after each engine call, during
  hashing and resampling, and between diarization operations; wire the Whisper
  abort callback. Legacy engines may only stop after returning. A cancelled call
  never returns a publishable success, even if the engine ignores the token.
  This API alone does not change desktop scheduling, enable capture concurrency,
  or prove native interruption latency. Preserve the existing engine entry point.
- The desktop lifecycle increment retains a join handle for validation/inference.
  Normal completion is consumed only after thread completion. Close requests
  cancellation and allows a 250 ms join grace; a still-running worker retains its
  capture exclusion and reports Stopping, never a successful shutdown. Recovery
  retry can close once the worker finishes. Explicit discard may still terminate
  the process under ADR 0020, without claiming the library joined. Channel teardown
  cancels and joins before the Store is released. Native model construction and
  ONNX operations can remain uninterruptible until their next boundary.
- This first lifecycle increment preserves the existing retryable failed state
  for interrupted jobs. Durable resumable requests/attempt tokens and automatic
  restart belong to the next queue migration; neither is claimed here.
- A constrained device may defer processing until after the call, showing why.
  GPU use is a user-selectable resource policy; CPU mode may be slower. Do not run
  ASR, diarization and a summarization LLM concurrently by default on limited VRAM.
- After pre-provisioning models, the full capture-to-transcript path works with
  egress denied. No transcript-bearing telemetry, crash uploads, model API calls or
  online post-processing. Loopback audio transport stays local. Optional calendar
  networking is separate and never uploads captured content.
- Persist bounded progress/checkpoints; recover after exit/crash without starting
  a new recording. See spec 0088 for status, cancellation and restart semantics.

## Benchmark and release gate

- Use consented, explicitly selected local fixtures or licensed public fixtures.
  Do not read the Handy history or operator recordings merely to populate a test.
- Freeze model/runtime hashes, preprocessing, quantization and language settings.
  Compare Tagarela windows against its offline full-context baseline, V3 against
  PT/EN/mixed fixtures, and native streaming against the same fixtures.
- Include conversational PT-BR, English, mixed sentences, technical names, numbers,
  overlap, silence, noisy headsets and long uninterrupted speech on both tracks.
  Measure WER/CER, named-entity/number errors, hallucinations, boundary omissions,
  repeated words and manual correction effort, not just transcription speed.
- Measure warm/cold latency, P50/P95 stable-text lag, model-switch time, peak RSS/
  VRAM, CPU/GPU load and thermal behavior during a two-hour simulated call.
  Include both tracks, context recomputation and diarization in the compute budget.
- Required throughput: processing keeps up with the wall-clock arrival of both
  tracks without sustained backlog. Target at most 50% wall-clock compute duty for
  ASR to leave headroom; this is a proposal to validate, not a measured result.
  No dropped capture samples or delayed Stop under stress. Report any missed target.
- Promote a default only after quality/latency/resource results are reviewed. A
  native streaming engine may replace windowed ASR if it wins this same comparison;
  near-real-time is not inherently more efficient than cached native streaming.

## Design and evidence

See [ADR 0021](../architecture/decisions/0021-local-incremental-asr.md) and
[the research note](../research/2026-10-26-local-transcription-options.md).
Implementation authorized by the user on 2026-10-26. Product direction is closed:
local near-real-time first, optional post-call mode, explicit consent per recording,
independent Handy use, recoverable work and truthful global status. Adapter
selection and measured thresholds remain engineering gates, not permission gates.
No runtime acceptance is claimed. Independent design reviews by the requested
Claude Opus 5.5 Work and Gemini 4 Argon (Antigravity) precede enabling concurrency.
