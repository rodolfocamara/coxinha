# 0099 — Speech models without setup and automatic speaker separation

Status: in-progress (P1–P4 implemented; owner's library being reprocessed)
Phase: F1
Date: 2026-11-02

## Why

After spec 0098 the owner asked that a fresh install transcribe and separate
speakers without picking files, and that past meetings get the same
treatment on their own. The decisions taken:

- transcription model: no model inside the installer. Use the one Handy
  already installed (Tagarela first), else offer a one-click download of a
  public model;
- speaker separation: bundle the current pyannote segmentation 3.0,
  WeSpeaker ResNet34 and ONNX Runtime (~55 MB). Saved voice profiles depend
  on the WeSpeaker embedding, so it stays;
- processing uses the Tagarela transcript instead of Whisper tiny, which is
  poor for pt-BR (spec 0098 P4).

## Non-goals

- Shipping Tagarela itself. There is no public build in the transcribe.cpp
  format; the owner's file is a local conversion of a third-party GGUF, so
  its chain of origin is too weak to redistribute.
- Overlapped-speech models (Sortformer). Larger, capped at 4 speakers and a
  new engine.
- GPU inference.

## Design

### P1 Word timings in the live transcript

- `LiveSegment.words` stores each word with `start_ms`/`end_ms` on the raw
  WAV clock (paused audio excluded), the clock of the diarization turns.
  Lines written before this field default to an empty list.

### P2 Processing over the live transcript

- `parameters.transcript = "live"` makes `LocalSpeechEngine` read the
  meeting's live transcript instead of running Whisper; both at once is an
  error.
- `speech/live_words.rs` groups words into segments that never cross a pause
  over 800 ms, a speaker turn or 15 s, so the existing overlap attribution
  sees one speaker per segment. Lines without words fall back to one segment
  per line and the run carries a warning.

### P3 Models without setup

- `speech_models::detect` looks in Handy's models directory, then in the
  app's `models` directory, and ranks files: Tagarela (matched first),
  Parakeet Ultra, Parakeet v3. An empty saved model path means "best local
  model"; a fresh install that finds one starts with live transcription on.
- `speech_model_download` (explicit click, "Baixar modelo" in Ajustes ›
  Transcrição local) fetches Parakeet TDT 0.6B v3 Q8 (739.5 MB, CC-BY-4.0)
  from `handy-computer/parakeet-tdt-0.6b-v3-gguf` at a pinned revision,
  streams progress, checks SHA-256 and only then renames the file into place.
- Speaker models ship in a `speech/` directory next to the binary (or
  `../lib/Coxinha/speech`): `segmentation.onnx`, `wespeaker.onnx` and the
  ONNX Runtime 1.22.0 CPU library. `processing_config` hashes them and
  records their origin and license in the run.
- Manual "Transcrever" uses that bundled config when the user has not chosen
  one in this run; without bundled models it still asks for a file.

### P4 Automatic speaker separation

- Once no meeting needs transcription, the backlog of spec 0098 picks the
  newest meeting with a complete transcript and no local-processing job, and
  starts processing with the bundled config. A meeting with any job, even a
  failed one, is left to the user, so failures never loop.
- Same priority rules as the transcription backlog: never while recording or
  processing; a call or manual processing goes first.

## Model provenance

| Model | Source | License |
|---|---|---|
| Parakeet TDT 0.6B v3 Q8 (download) | huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf @ d8d8c32 | CC-BY-4.0 |
| pyannote segmentation 3.0 ONNX | huggingface.co/onnx-community/pyannote-segmentation-3.0 @ 733a93b | MIT |
| WeSpeaker ResNet34-LM | huggingface.co/WeSpeaker/wespeaker-voxceleb-resnet34-LM @ f0c48c2 | CC-BY-4.0 |
| ONNX Runtime 1.22.0 CPU | github.com/microsoft/onnxruntime releases v1.22.0 | MIT |

## Acceptance

- [x] Live transcript lines carry word timings on the raw clock
      (`live::worker_tests`).
- [x] Words become segments split at pauses and speaker turns; old lines fall
      back with a warning (`speech::live_words` tests).
- [x] Model ranking prefers Tagarela, then Ultra, then v3, ignoring other
      files (`speech_models` tests).
- [x] "Baixar modelo" shows progress and turns live transcription on
      (`live.test.tsx`).
- [x] "Transcrever" uses the bundled config when none was chosen
      (`MeetingsHub.detail.test.tsx`).
- [x] Packaging: `scripts/fetch_speech_models.py` fetches the pinned files
      (SHA-256 checked) and `tauri.speech.conf.json` ships them as `speech/`;
      the lookup matches the Windows, deb/AppImage and macOS layouts
      (`speech_models` tests). A Linux deb was built and holds
      `usr/lib/Coxinha/speech/` with the three files.
- [ ] Windows installer built by the release workflow and checked on a
      Windows machine.
- [x] Owner's library: every meeting transcribed with word timings and
      separated by speaker without a click (8 automatic runs, spec 0101).
