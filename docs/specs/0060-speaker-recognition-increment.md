# 0060 Local speaker recognition increment

Status: implemented; local tests and independent review completed. Native user
acceptance and validated recognition quality remain pending. Implements a bounded vertical increment of the
[recognition plan](../plans/2026-10-19-speaker-recognition-and-calendar.md).
Does not close physical capture, Windows, Graph OAuth or acoustic calibration.

## Outcomes

Import one local WAV, process locally, attribute text conservatively to anonymous
speakers, review names and confirm a person with explicit enrollment consent.
Display calibrated voice suggestions on later processing runs when a compatible
validated policy is installed; otherwise explain unknown. Allow manual meeting
participant context to supply candidate names without granting acoustic evidence.

## Contracts

- Preserve existing v1 dual-source manifests and raw audio. A new source format
  admits one imported track with bounded, validated PCM WAV input. Explicitly
  reject unsupported audio with actionable errors. No dummy second channel.
  Import copies into owned private storage, validates hashes and durations,
  cleans up only its own incomplete files and never alters the user's input.
- Track preparation, enrollment, playback and export accept the new source while
  old recordings stay readable. Track IDs and files are allowlisted by manifest;
  reject traversal, symlinks escaping owned storage and inconsistent metadata.
- Attribute text using same-track overlap aggregated by anonymous speaker. No
  nearest-speaker guess across silence; ties, mixed speech and low coverage
  abstain. Record algorithm parameters/version; do not call them confidence.
- Assignment identity is scoped to processing run, track and speaker, not merely
  a label reused across runs. Retain historical decisions and raw input when
  reprocessing. Older ambiguous bindings remain legacy, never auto-transferred.
- Confirming a label and enrolling selected clean samples are separate explicit
  actions/options. Match is read-only; suggestions never enroll automatically.
  Preserve revoke/correct behavior and compatible embedding-space validation.
- Persist versioned calibration policies and evidence. Suggestions identify the
  policy and profile generation. Policy replacement/revocation invalidates prior
  suggestions, never human confirmations. Missing policy means unknown. No
  arbitrary threshold file is presented as acoustically validated.
- Manual participant context is private, explicitly user-entered and independent
  of confirmed attendance. Names/emails can prefill review/create-person only;
  no assignment by invitation, order or speaking time. Same name is not identity.
  This increment does not claim to fetch calendar events or verify attendance.
- UI uses translated English/pt-BR strings, keyboard controls, explicit errors,
  and busy handling. Store stays on its worker; blocking file import/inference
  cannot run while capture is active. Public artifacts never contain profiles,
  candidate embeddings, policy diagnostics or complete invite lists.

## Shared desktop contract

Backend and UI owners coordinate changes through this contract before changing
existing commands. Preserve old APIs where possible. New command names:

- `library_import_audio(title, path)` returns LibraryDetail with per-track audio.
- `library_recognition(job)` returns read-only per-speaker suggestions/unknown,
  evidence reasons and calibration status, separate from confirmed assignments.
- `library_participant_context(meetingId)` reads manually entered name/email rows.
- `library_set_participant_context(meetingId, participants)` explicitly replaces
  those rows; does not mutate voice profiles or confirmations.
- Extend `library_confirm_speaker` with explicit enrollment opt-in, default false
  for new UI clients; coordinate backward compatibility and tests explicitly.

Exact DTO shapes must be agreed by backend/frontend owners and documented in
their evidence. Do not invent successful browser mocks as desktop acceptance.

## Acceptance tests

- [ ] Single-track import -> processing -> playback -> confirm/enroll -> later
  query; invalid or incomplete import leaves existing meetings untouched.
- [x] Old dual-track manifests, checksums, recovery and enrollment still work.
- [x] Same-track overlap, repeated turns of one speaker, ties, crossing speakers,
  gaps, unknown turns and other-track overlap have meaningful alignment tests.
- [x] Reprocessing with reused labels cannot inherit prior confirmed identities.
- [x] Default unknown, incompatible model, policy changes and revoke/correct
  prevent stale or contaminated voice suggestions.
- [x] Manual candidates never learn voices or mark presence; homonyms remain
  distinct and context cannot cross meetings or leak into default export.
- [x] UI imports, shows errors/busy states, previews names and separates explicit
  enrollment from naming; tests cover both languages and backend failures.
- [x] Real local speech fixture proves inference separately from synthetic tests;
  report incorrect attribution and coverage, not just passing unit tests.

Evidence: [2026-10-23 validation](../research/2026-10-23-speaker-recognition-increment.md).
The first checkbox retains native end-to-end playback/confirmation acceptance;
core and mocked UI tests do not substitute that gate.

No real microphone activation, tenant access, credentials, push or deployment is
part of these tests. Keep physical capture and calibrated open-set identity
acceptance marked pending until demonstrated with appropriate data.
