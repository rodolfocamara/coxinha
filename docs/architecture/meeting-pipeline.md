# Meeting pipeline

> Emenda 2026-10-17: ADR-0018 e spec 0058 prevalecem no domínio de reuniões.
> Linux+Windows, biblioteca independente de notas, trilhas originais separadas,
> core sem Tauri, bancos canônicos separados e identidade apenas confirmada.
> Regras anteriores conflitantes permanecem abaixo como histórico, sem vigência.


The meeting pipeline is the sequence that turns a real call into a
recording, transcript, and summary stored in the vault. This doc
fixes the state machine, the engine defaults, and the fallback
behavior when something along the way fails.

The on-disk source of truth for a meeting's state is its
`metadata.json::status` field (see `vault-schema.md`). The DB row
mirrors it for fast queries.

## State machine

```
idle
  │
  │   user clicks Record  OR  call_detected + user confirms (0005)
  ▼
recording ─────── user stops  OR  max-duration timer
  │
  ▼
recorded ──────── transcribe_meeting invoked (auto after stop, or manual)
  │                                            │
  │                                            ▼  on error (after retries)
  │                                         failed
  ▼
transcribing
  │
  ▼
transcribed ───── diarizer != None  ?  yes → diarizing
  │                                  no → diarized (skip)
  │                                            │
  │                                            ▼  on error (no retry)
  │                                         partial  (transcript kept, no speakers)
  ▼
diarizing
  │
  ▼
diarized ───────  summarizer configured ? yes → summarizing
  │                                     no → ready (skip)
  │                                            │
  │                                            ▼  on error (after retries)
  │                                         partial  (no summary)
  ▼
summarizing
  │
  ▼
ready
```

### Valid `status` values

- `recording`, `recorded`
- `transcribing`, `transcribed`
- `diarizing`, `diarized`
- `summarizing`, `ready`
- `failed` — hard failure that left the meeting without a usable
  transcript
- `partial` — transcript exists but one of the soft stages
  (diarization, summary) failed

## Events and transitions

| Event | From | To | Writes |
|---|---|---|---|
| `start_recording(title)` | `idle` | `recording` | `metadata.json` with `status=recording`, new DB row |
| `stop_recording()` | `recording` | `recorded` | finalizes WAV, fills `ended_at`, `duration_seconds` |
| `transcribe_meeting(id)` begins | `recorded` | `transcribing` | `status=transcribing` |
| `Transcriber::transcribe_file` ok | `transcribing` | `transcribed` | `transcript.json`, `has_transcript=true` |
| `Transcriber` errors past retry | `transcribing` | `failed` | `status=failed`, `error=<msg>` |
| diarization starts (non-None) | `transcribed` | `diarizing` | `status=diarizing` |
| `Diarizer::diarize` ok | `diarizing` | `diarized` | segments patched in `transcript.json` |
| `Diarizer` errors | `diarizing` | `partial` | transcript kept unchanged |
| summarization starts | `diarized` | `summarizing` | `status=summarizing` |
| `Summarizer::summarize_meeting` ok | `summarizing` | `ready` | `summary.md`, `has_summary=true` |
| `Summarizer` errors past retry | `summarizing` | `partial` | transcript kept |

## Crash recovery

If the process dies mid-transition, the next launch reconciles
using `metadata.json` on disk:

- **Crash during `recording`** — WAV header is incremental; file
  plays back up to the kill point. Coxinha bumps `status` to
  `recorded` with `ended_at = file_mtime`.
- **Crash during `transcribing` / `diarizing` / `summarizing`** —
  `status` on disk points at the last started stage. Coxinha
  offers "resume from <stage>" on meeting open; the user confirms.
- **Half-written files** — `transcript.json` and `summary.md` are
  always written via `tempfile + rename`. A crash mid-write
  leaves either the previous version or no file at all; never a
  truncated one.

## Retry policy

- **Transcription** — 1 retry on transient errors (model load I/O,
  file lock). After that, `failed`.
- **Diarization** — 0 retries. If pyannote fails, accept the
  transcript without speaker labels; meeting goes to `partial`,
  not `failed`.
- **Summarization** — 1 retry for cloud LLMs on network errors;
  0 for local (Ollama). Failure leaves the transcript and marks
  `partial`.

## Engine defaults (MVP)

| Role | Default | Rationale |
|---|---|---|
| Transcriber | `Whisper` with `ggml-base.bin` on CPU | Smallest reliable path; no CUDA toolkit required; baseline quality is good enough for PT-BR |
| Diarizer | `None` | Zero-setup MVP. User flips to `Pyannote` in Settings once models are downloaded |
| Summarizer | `Ollama` at `localhost:11434`, model `llama3.2:3b` | Works fully offline; no API key required. Claude / OpenAI are opt-in |

Parakeet is opt-in under the `stt-parakeet` feature flag and is
not the MVP default.

## Fallback rules

| Condition | Behavior |
|---|---|
| Transcriber model file missing | Fail with the explicit path and the `scripts/download-models.sh` command. Never silently swap engines. |
| `accelerator=cuda` but CUDA not available at runtime | Log a warning, retry once on `Cpu`, then fail if CPU also fails. |
| Diarizer model files missing | Fall back silently to `NoneDiarizer`. Surface a toast: "Diarization unavailable; run download-models.sh for speakers." |
| LLM provider unreachable | Fail with provider name + error. `transcript.json` stays intact; `summary.md` is not written. Meeting is `partial`. |
| Ollama up but model not pulled | Surface `ollama pull <model>` as the fix. Don't retry automatically. |
| `llm.provider=claude` with no `ANTHROPIC_API_KEY` | Clear error naming the env var. Do not panic. |

## Code ownership

| Concern | Where it lives |
|---|---|
| `idle ↔ recording ↔ recorded` | `src-tauri/src/recorder.rs` |
| `call_detected` → user prompt | `src-tauri/src/call_detector.rs` + frontend toast (spec 0007) |
| Orchestration of `recorded` → `ready` | `transcribe_meeting` orchestrator (spec 0008 design notes). Loads the meeting, calls `Transcriber` → `Diarizer` → `Summarizer` in order, writing each artifact and flipping `status` per step. |
| `metadata.json` I/O | `src-tauri/src/storage.rs` (add `read_meeting_metadata`, `write_meeting_metadata`) |

The orchestrator is the only place that mutates `status`. Traits
(`Transcriber`, `Diarizer`, `Summarizer`) return data; they do not
touch `metadata.json`.

## Testing

Covered under spec 0002:

- Unit tests on the state-transition helper (no real audio/LLMs).
- Integration test: happy-path `recorded → ready` with a fixture
  WAV and a fake LLM.
- Crash-recovery test: start recording, `SIGKILL`, verify the
  next startup reconciles `status` correctly.
- Fallback tests: missing model, missing CUDA, missing API key —
  each produces the expected error and final `status`.
