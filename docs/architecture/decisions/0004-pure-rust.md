# ADR-0004: Pure Rust, no Python sidecar

> Emenda 2026-10-17: ADR-0018 e spec 0058 prevalecem no domínio de reuniões.
> Linux+Windows, biblioteca independente de notas, trilhas originais separadas,
> core sem Tauri, bancos canônicos separados e identidade apenas confirmada.
> Regras anteriores conflitantes permanecem abaixo como histórico, sem vigência.


- **Date:** 2026-04-18
- **Status:** Accepted

## Context
AiNotes uses a Python sidecar for faster-whisper. It works, but
adds +200MB to the bundle and complicates the build.

## Decision
100% Rust. `whisper-rs` (whisper.cpp binding) + `transcribe-rs`
(Parakeet/ONNX) + `pyannote-rs` or `speakrs` (diarization).

## Consequences
- **+** Single binary, no Python runtime
- **+** No subprocess startup overhead
- **−** Building `whisper-rs` on Windows may require a full toolchain;
  CI handles it
