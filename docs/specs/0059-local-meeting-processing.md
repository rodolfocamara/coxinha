# 0059 — Local post-meeting processing

Status: implementing. Extends 0058 and ADR-0018; does not close hardware acceptance.

## Scope

Process a closed recording with explicitly selected local model files. Preserve the original two tracks and their individual audio timelines. Produce versioned transcripts, anonymous speaker turns and private embeddings. Let the user confirm a speaker as a persistent person, correct/revoke that decision, and keep recognition unknown unless a compatible calibrated policy exists. No download, network, enrollment or identity confirmation happens implicitly.

## Contracts

- Core processing is independent of Tauri. A durable job owns immutable input/config/model hashes and engine version. Processing failures remain visible and retryable. Repeating the same inputs reuses the completed job; human corrections remain separate from machine output.
- A pure inference worker receives owned paths/configuration and returns a result. SQLite stays on its owning worker. Initially processing and capture are mutually exclusive, with a clear busy state, so loading models and hashing files cannot starve capture. Status/list remain responsive while inference runs.
- Raw PCM16 mono 48 kHz becomes derived normalized mono 16 kHz using anti-alias filtering. Models are local files, validated with hashes and provenance. Raw tracks are never overwritten. Timestamps refer to each track's playback timeline, not falsely exact wall-clock synchronization.
- Optional CPU engines: Whisper for transcription; normalized ONNX segmentation and WeSpeaker for diarization/embeddings. No speaker is inferred from microphone/output labels. Anonymous clustering is experimental and its parameters/version are recorded. Overlap is retained and uncertain text attribution stays unknown.
- Public transcript artifacts exclude embeddings. Embeddings and enrollment candidates live under private storage and are never included in meeting export. Model family, revision, checksum, preprocessing, dimension and source interval accompany samples.
- Confirmation is an explicit human decision. Only confirmed samples enter voice memory. Correcting or revoking invalidates previous contributions. Reprocessing cannot silently transfer confirmed names to newly clustered speaker labels. Scores are similarities, never fabricated confidence percentages.
- Default cross-meeting matching abstains without calibration. Shipping the plumbing or a synthetic match does not establish acoustic accuracy.
- UI exposes processing state/error, timestamps, source track, anonymous speakers and confirmed identities, with English/pt-BR strings and keyboard-accessible controls. Missing engines/models are actionable states, never fake successful transcripts.

## Verification

Meaningful tests cover input/checksum rejection, normalization/timestamps, idempotence and failure/retry, correction persistence, private export boundary, incompatible embeddings, unknown voice and confirmation/revocation. A public licensed speech fixture exercises real CPU inference separately from synthetic tests. Record exact model/fixture versions, hashes, license, measured outputs and limitations. Physical Jabra/Linux retest, Windows capture and user acceptance remain distinct pending gates.

## Implementation evidence, 2026-10-18

Code and incremental UI are implemented. Core 30 unit + 1 process integration, Tauri 86, frontend 99 passed; real-embedding lifecycle probe passed separately. Real CPU inference ran on public English/Portuguese speech and in an isolated network namespace. See [acceptance evidence](../research/2026-10-18-local-processing-acceptance.md).

Keep this spec in progress: acoustic clustering over-split three people into four groups; conservative transcript-to-turn alignment left speaker attribution unknown; automatic persistent recognition has no calibrated policy. Physical capture acceptance and Windows remain separate pending gates. This is a testable increment, not completion of the full product objective.

The [speaker recognition and calendar plan](../plans/2026-10-19-speaker-recognition-and-calendar.md)
defines the next increments and acceptance gates. Calendar attendees provide
name candidates for human review, never proof of presence or acoustic identity.
This follow-up plan does not mark these capabilities implemented.
