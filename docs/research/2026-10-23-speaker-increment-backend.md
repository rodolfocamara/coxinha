# Backend speaker increment evidence, 2026-10-23

The increment adds one-source WAV import, conservative overlap text alignment,
run/track-scoped human naming, explicit opt-in enrollment, private manual
participant context and read-only acoustic queries. Default recognition remains
unknown. No acoustic policy is shipped or installed by the desktop.

## Desktop DTO agreement

- `library_import_audio({title,path})` returns existing LibraryDetail with
  `audio: Record<string,string>`, keys `mic`, `output`, or `imported` as present.
- `library_confirm_speaker({job,speaker,personId,humanOrigin,enroll?,track?})`:
  absent enrollment means false; absent track is accepted only when the speaker
  exists on exactly one source. New assignment identity is `job:track:speaker`.
  Older ambiguous assignments have null track and are never transferred.
- `library_recognition({job})` returns `{job,calibrationStatus,profileGeneration,
  speakers:[{speaker,track,state,reason,personId,name,policyId,cosineSimilarity}]}`.
  State is unknown or suggested, separate from human assignments. Results use
  current policy/profile state and do not create people, samples or assignments.
- `library_participant_context({meetingId})` and
  `library_set_participant_context({meetingId,participants})` return rows
  `[{name,email:string|null}]`. Context is private, manual, meeting-scoped and
  does not establish attendance or identity. Equal names remain separate rows.

## Contracts and limits

V1 manifests remain readable without rewriting raw files or provenance. V2 is
one imported PCM16 mono 48 kHz WAV, at most two hours; legal WAV chunks are read
with hound and the complete input file is copied and hashed unchanged. Imported
folders/files receive 0700/0600 on Unix. Traversal, raw directory aliases,
symlinks, checksum/metadata discrepancies and incomplete sample payloads fail.
Playback, preprocessing, enrollment, backup and export use the source allowlist.
Recovery explicitly retains two-source cardinality for v1 and checks owned paths,
including journal/pending-manifest symlinks, before changing capture headers.

Text attribution is `overlap-v2`: union coverage at least 70% on the same track;
any competing or unknown overlapping speaker abstains. Repeated turns do not
count twice. No nearest-neighbor attribution across silence. These are versioned
algorithm parameters, not confidence or validated acoustic thresholds.

Naming and enrollment are separate. Enrollment failure leaves the human name
confirmed and reports the failure; no-candidate enrollment is an error. Samples
are restricted to the assigned source, and turns overlapping another or unknown
speaker cannot enroll. Acoustic noise/echo/quality eligibility is still
experimental and is not declared clean or acoustically validated.

Profiles DB v3 adds private participant context and versioned calibration
policies, with transactional migration. Installing a policy is a core-only API
requiring compatible space and declared disjoint open-set evidence; there is no
user-facing install command. Lifecycle tests use explicitly synthetic policies
in disposable libraries. This is plumbing proof, not real calibration. Policy
revocation/replacement affects the next read without expiring human decisions.

Public exports contain selected meeting audio/transcript and confirmed labels,
not participant context, vectors, private profiles or policy diagnostics.

## Validation

Core tests cover old manifests/recovery, single import, source immutability,
truncated import cleanup, symlink rejection, run/track scope, naming without
embedding, separate enrollment, policy lifecycle, private context/export and
transactional migration failure. Executed offline with cargo jobs=2: core `--features local-processing` passed
40 unit tests and one process recovery integration; Tauri `--lib --features
local-processing` passed 87 tests with the existing explicit ONNX runtime. The
opt-in real-embedding lifecycle test passed separately on a disposable backup of
`target/recognition-validation-20261023/library`; all three held-out probes stayed
unknown without calibration, and correction/revocation invalidated contributions.

Enrollment verifies source hashes once before and once after a batch, retaining
per-sample source/hash/interval validation. A ten-turn test asserts exactly four
hashes for the two-source batch. A changed source at the final check revokes all
samples added by that batch. Playback detail verifies sources once.

CLI rebuilt with `local-processing`; desktop build with
`local-processing,tauri/custom-protocol` passed after the frontend owner froze
`dist`. Core Clippy with `--features local-processing -- -D warnings`, rustfmt
and `git diff --check` passed.

Final local binaries (not a deployment):
- Desktop SHA-256: `017d003f82d1228245aac242ebb4309279073d8d247628ab261cef0a045e17dd`.
- CLI SHA-256: `ea9ed2fe971b5f223fd6f631c0dba187848a3a26d1d3f77d2310bbd3e9ad8340`.

The final recovery cardinality/path checks were added after the independent R2
snapshot and require the separate root review; they are not represented as
independently reviewed by that snapshot.

Physical microphones, Windows hardware, validated open-set identity accuracy,
Graph/OAuth and production data were not exercised by this backend increment.
