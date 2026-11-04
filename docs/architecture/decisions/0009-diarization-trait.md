# ADR-0009: Diarization as a pluggable trait

> Emenda 2026-10-17: ADR-0018 e spec 0058 prevalecem no domínio de reuniões.
> Linux+Windows, biblioteca independente de notas, trilhas originais separadas,
> core sem Tauri, bancos canônicos separados e identidade apenas confirmada.
> Regras anteriores conflitantes permanecem abaixo como histórico, sem vigência.


- **Date:** 2026-04-18
- **Status:** Accepted

## Context
Multi-speaker meetings require diarization. Rust options:
- `pyannote-rs` — simple pipeline, CPU
- `speakrs` — full pyannote community-1 pipeline, 2-7x faster on
  CUDA, matches pyannote DER
- `sherpa-onnx` — C++ with bindings, heavy but complete

## Decision
`Diarizer: Send + Sync` trait. Implementations:
- `NoneDiarizer` (dev default; passes segments without speaker labels)
- `PyannoteDiarizer` via `pyannote-rs` (simple, stable)
- `SpeakrsDiarizer` via `speakrs` (production)

## Consequences
- **+** MVP does not depend on diarization working
- **+** Upgrading from pyannote-rs → speakrs is a config change
- **−** Extra ONNX models to download (~100MB)
