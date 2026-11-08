# Spec 0008: Meeting pipeline — transcribe + diarize + summarize

> Emenda 2026-10-17: ADR-0018 e spec 0058 prevalecem no domínio de reuniões.
> Linux+Windows, biblioteca independente de notas, trilhas originais separadas,
> core sem Tauri, bancos canônicos separados e identidade apenas confirmada.
> Regras anteriores conflitantes permanecem abaixo como histórico, sem vigência.


- **Status:** draft
- **Phase:** F1
- **Owner:** Rodolfo
- **Depends on:** spec 0007 (recording + call detection)
- **Relevant ADRs:** ADR-0004 (pure Rust), ADR-0005 (`genai`), ADR-0008 (STT trait), ADR-0009 (diarization trait), ADR-0010 (ONNX)
- **Related docs:** [`architecture/meeting-pipeline.md`](../architecture/meeting-pipeline.md) (state machine, retries, fallback matrix), [`architecture/vault-schema.md`](../architecture/vault-schema.md) (`transcript.json`, `summary.md`)

## Why
Everything downstream of a finished `recording.wav` that turns it
into something the user actually reads: a transcript, speakers on
top of it, and a structured summary. One spec because in practice
they run as a single orchestrated chain; splitting them back into
three invited the "which spec owns `transcribe_meeting`?" ambiguity
we hit in the skeleton.

## Scope

### In — `Transcriber` trait
- `async fn transcribe_file(&self, wav: &Path) -> Result<TranscriptBody>`
  (segments + language; caller attaches the meeting id)
- `WhisperTranscriber` via `whisper-rs` — **MVP default**,
  `ggml-base.bin` on CPU
- `ParakeetTranscriber` via `transcribe-rs` + ONNX INT8 — opt-in
  via the `stt-parakeet` feature
- Lazy load on first use; cached context reused across calls
  (refactor already made this real)

### In — `Diarizer` trait
- `async fn diarize(&self, wav, segments) -> Result<Vec<TranscriptSegment>>`
- `NoneDiarizer` — MVP default, transcript without speakers
- `PyannoteDiarizer` via `pyannote-rs` — `segmentation-3.0` +
  wespeaker embeddings + clustering
- `SpeakrsDiarizer` placeholder (F1.5 ships the real impl)

### In — `Summarizer`
- Single `genai::Client` per summarizer; `OLLAMA_HOST` set once at
  `new()`, not per call
- Default provider: **Ollama** `localhost:11434`, model
  `llama3.2:3b` — the only fully-offline option
- Claude / OpenAI / Groq / OpenRouter are opt-in via config
- Default prompt in English; future per-user template override at
  `~/coxinha/.coxinha/prompts/summary.md`
- Writes `summary.md` with the frontmatter defined by
  `vault-schema.md`

### In — Orchestration (`transcribe_meeting`)
- Command that walks the state machine in `meeting-pipeline.md`:
  - `recorded → transcribing → transcribed` (writes `transcript.json`)
  - `transcribed → diarizing → diarized` when diarizer isn't `None`
    (patches `speaker` fields in `transcript.json`)
  - `diarized → summarizing → ready` when summarizer is configured
    (writes `summary.md`)
- Retry policy per `meeting-pipeline.md`: 1 retry on transcription
  transient errors, 0 on diarization (soft → `partial`), 1 on cloud
  summarization
- Writes `transcript.json` and `summary.md` atomically (tmp +
  rename), never truncated on crash
- Updates DB flags `has_transcript`, `has_summary` and the
  `metadata.json::status` in lockstep

### Out
- Streaming / realtime transcription → F1.5+
- Manual transcript editing → F1.5+
- Per-meeting prompt overrides → F1.5+
- Structured action-item extraction (JSON, not prose) → F4
- Follow-up email / Slack generation → F3+

## Behavior (acceptance)
- **Happy path (default MVP engines):** a 1-minute recording
  reaches `status=ready` within the budget set by spec 0003,
  `transcript.json` validates against `vault-schema.md`,
  `summary.md` has the expected frontmatter and section layout
- **Cached model:** second transcription in the same process does
  NOT reload the model from disk
- **Missing model file:** fails with a message pointing at
  `scripts/download-models.sh`; does not silently swap engines
- **CUDA configured, unavailable:** log warn, retry once on CPU,
  then `failed` if CPU also fails
- **Missing diarization model:** soft-fallback to `NoneDiarizer`,
  meeting ends at `partial` with transcript intact
- **LLM unreachable / missing API key:** fails with the provider
  name + env var; transcript stays; meeting ends at `partial`
- **Crash mid-stage:** next launch reads `metadata.json::status`,
  offers "resume from <stage>", never produces a truncated artifact
- **Idempotency:** retranscribing overwrites `transcript.json`,
  doesn't append

## Design notes
- The orchestrator is the only place that mutates `status` in
  `metadata.json`; the three traits return data, they don't touch
  files
- Traits live under `src-tauri/src/transcriber/`, `diarizer/`,
  and `summarizer.rs` — all three already scaffolded
- `shared::TranscriptBody` (segments + language, no `meeting_id`)
  avoids the old `Uuid::nil()` fake
- Audio is pre-processed to 16kHz mono f32 (spec 0007 delivers
  that format)
- Blocking work goes through `tokio::task::spawn_blocking`

## Open questions
- Auto-trigger orchestration on `stop_recording`, or only on a
  button press? Default to manual — CPU/GPU cost should be explicit
- `transcribe-rs 0.3` API: confirm field names (`result.segments`,
  `result.language`) match during spec 0001 pinning
- `pyannote-rs` real crates.io version (0.2.x vs 0.3) — pin in
  spec 0001
