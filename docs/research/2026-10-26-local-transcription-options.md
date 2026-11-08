# Local transcription options and meeting lifecycle

Date: 2026-10-26. Scope: read-only product/model inspection and primary-source
research; specifications only. No inference, recording, model download, application
launch, operator transcript access or runtime configuration change was performed.

## Recommendation

Target near-real-time local text first, using the user's preferred Tagarela in
bounded windows. Evaluate native streaming as a challenger rather than assuming
that windowed inference is faster or more efficient. Keep capture independent,
show pending work globally and preserve reversible meeting boundaries.

The choice is about latency and local resources, not whether data must leave the
device: both windowed ASR and native streaming can run entirely offline.

## Observed host and installation

| Item | Observed evidence | Limit |
| --- | --- | --- |
| CPU | Intel Core i7-12700H, 20 logical CPUs (`lscpu`) | Not an ASR benchmark |
| GPU | RTX 3060 Laptop GPU, 6144 MiB (`nvidia-smi`), driver 580.178.04 | Does not prove engine GPU support or available headroom |
| Active Handy model file | `parakeet-v3-ptbr-tagarela-matched-q8.gguf`, 739,508,064 bytes | File size is not resident memory |
| Archived original | `.tagarela-original-parakeet-cpp.gguf.backup`, 940,663,808 bytes | Not a second verified language profile |
| Recorded conversion | `parakeet.cpp` to `transcribe.cpp 0.2.4`, 695 copied tensors, 2 fused LSTM biases, tokenizer comparison | Read from local provenance; not independently rerun |

Model directory: `~/.local/share/com.pais.handy/models/`.
Selected metadata: `model-provenance/tagarela/manifest.json` and key names in
`conversion-proof.json`; history, audio examples, transcription outputs and saved
settings were not consulted. The manifest names source
`luizhrocha/parakeet-tdt-0.6b-v3-ptBR-gguf`, file `ptbr-plus-q8_0.gguf`.
Its recorded installed hash is
`a409d1ac2c43bd41a63ae8efcb799cff82cb497c6fcd994b91907938563a2172`;
the large model was not rehashed in this planning pass.

The user reports this model is most effective for their Portuguese. That is useful
selection evidence, but not a controlled comparison on two-track meeting audio.

## Current Coxinha gaps (source inspected)

- `coxinha-core/src/speech.rs`: whole-track normalization and Whisper invocation;
  `use_gpu(false)` and automatic Whisper language detection. No Tagarela adapter.
- `src-tauri/src/library/processing.rs`: active capture excludes processing;
  validation/inference states do not expose measured audio coverage.
- `src-tauri/src/library.rs` finish path: capture finalization does not schedule
  ASR. `ProcessingPanel` requests processing explicitly.
- `src-tauri/src/call_detector/episodes.rs`: PID/process grouping and absence
  debounce, not remote meeting identity. Failed observations preserve active state.
- Direct-capture consent creates/binds a session; it does not implement end-of-call
  segmentation or guarantee recognition of successive calls within one process.

These observations explain why an installed model/GPU does not mean the current
app is already transcribing after Stop. They do not diagnose an individual running
job or inspect the user's just-recorded meeting.

## Market patterns (primary documentation, accessed 2026-10-26)

| Product | Documented behavior | What to reuse / avoid |
| --- | --- | --- |
| [Handy](https://handy.computer/docs/models) | On-device ASR, selectable models; Parakeet V3 multilingual | Local model selection; dictation UX is not proof of long-call scheduling |
| [MacWhisper](https://www.macwhisper.com/) | Local transcription, meeting capture, offline processing options | Demonstrates a local desktop workflow; no Linux runtime parity claimed |
| [Granola](https://www.granola.ai/blog/local-first-ai-notetaker-vs-cloud) | Device capture, cloud transcription and summaries; desktop transcription during calls | Clear ongoing transcription UX; cloud processing conflicts with this request |
| [Otter desktop](https://help.otter.ai/hc/en-us/articles/35973988280215-Otter-Desktop-App-Mac-Windows) | End detection and Keep recording | Visible, recoverable boundary handling; not proof of local ASR |
| [Wispr Notetaker](https://docs.wisprflow.ai/articles/9319084321-Notetaker-settings,-explained) | End/reconnect settings and call reminders | Avoid merging different calls and suppressing reminders merely because busy |

Botless capture and deleting audio after transcription do not imply that audio
never left the computer. Do not infer private implementation details or streaming
models from these products' marketing; their exact ASR engines are not established
by this comparison.

## Model evidence and candidate policy

- [NVIDIA Parakeet V3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
  supports Portuguese and English with automatic language detection. NVIDIA notes
  a European-Portuguese training versus Brazilian-Portuguese evaluation difference.
  This supports testing one multilingual engine for mixed meetings; it does not
  establish reliable code switching on short noisy chunks.
- The [Tagarela ONNX derivative card](https://huggingface.co/alefiury/parakeet-tdt-0.6b-v3-ptBR-TAGARELA-onnx)
  describes PT-BR adaptation and explicitly does not guarantee other-language
  performance. Its published dataset results are not measurements of the installed
  converted GGUF. Do not extrapolate its WER to this machine or meeting corpus.
- The [installed model's source card](https://huggingface.co/luizhrocha/parakeet-tdt-0.6b-v3-ptBR-gguf)
  identifies a Parakeet.cpp Q8 conversion. Its speed/quality example is a single
  recording, not a general benchmark. Local provenance records the further Handy
  conversion, so matching GGUF file extension alone is insufficient compatibility.
- [Handy's native runtime documentation](https://github.com/handy-computer/transcribe.cpp/blob/main/docs/models/parakeet.md)
  distinguishes offline Parakeet variants from streaming variants. Pin a compatible
  version and verify tensors/tokenizer/timestamps before choosing this adapter.
  Current upstream documentation is not proof of capabilities in installed 0.2.4.
- [NVIDIA Nemotron 3.5 ASR streaming 0.6B](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b)
  is a cache-aware streaming candidate supporting PT-BR and English, with language
  conditioning/auto detection. Its documented 80–1120 ms chunk choices describe
  model operation, not end-to-end latency on this laptop. Published H100 throughput
  must not be used as a laptop estimate. Audit model/runtime licenses before bundling.
- [Whisper-Streaming research](https://aclanthology.org/2023.ijcnlp-demo.3/)
  demonstrates local-agreement/adaptive-latency policies around an offline model.
  It motivates explicit stable/provisional text, not an assertion that a Parakeet
  chunk adapter automatically implements the same algorithm.

## Proposed comparison before implementation defaults

1. Freeze a small licensed or explicitly selected PT-BR/EN/mixed corpus and the
   existing model/runtime hashes. Do not automatically discover personal recordings.
2. Compare Tagarela windowed/offline, original V3 windowed, existing Whisper and
   native Nemotron streaming. Missing candidates remain untested until explicitly
   provisioned; no downloads are part of this document change.
3. Evaluate two-track throughput, stable-text latency, sentence-boundary errors,
   names/numbers, silence hallucinations, language drift and correction effort.
4. Run sustained contention against simulated conferencing and capture. Test CPU
   before assuming GPU is necessary; compare actual supported GPU execution next.
   Keep one ASR model resident, and defer heavy diarization/summary when necessary.
5. Pick the least complex local engine meeting the user's quality/latency needs.
   Do not run two ASR models simultaneously just to present one preview and a
   second final transcript unless measured quality justifies the resource cost.

Draft acceptance is in specs 0087–0089 and ADR 0021. No performance, native media
or quality gate has been executed in this planning pass.
