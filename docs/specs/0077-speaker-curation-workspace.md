# 0077 — Session people and voices workspace

Status: in-progress. Frontend only; browser, real audio and native acceptance belong to the parent. No commit, push, application launch, operator-data access, Rust, root dist or launcher changes.

## Why

Speaker curation is buried inside transcript processing and a shared person selection can accidentally be applied to different voices. A session needs a focused workspace where a person can listen to one bounded excerpt, choose an identity independently and explicitly save or correct it.

## Scope

Add a fourth session tab, People & voices, beside Notes, Transcript and Summary. Keep the legacy meetings utility functional. Share one processing/job controller between transcript and speaker views. Preserve capture ownership, transcript corrections and historical jobs using existing IPC DTOs and commands. Do not implement recognition, thresholds, calibration, automatic assignments or automatic enrollment.

## Acceptance

- Tab arrows, Home and End derive their bounds from the tab list. Every tab controls a labelled panel. Hidden content never receives programmatic playback focus. English and Brazilian Portuguese remain accessible at 800px with existing theme tokens.
- Each `(track, speaker)` has its own person choice, provenance and enrollment opt-in, initially false. Confirmed names, proposed names and anonymous labels are distinct. Unknown/overlapping speech has no identity confirmation action.
- Select known people or explicitly create a person using a separate, meaningful consent-origin field. Agenda candidates only prefill a new person's name, without granting identity or attendance. Human decision provenance is required for saving, correcting and revoking. Never manufacture consent.
- Save/Correct calls `confirmSpeaker(job, speaker, person, origin, enroll, track)`. Optional enrollment attempts all available voice segments for this speaker on this track, not just the excerpt played. Any unsuitable segment, including same-track overlap, may cause the entire enrollment batch to fail; the interface must not imply silent filtering or per-sample selection. Revoke uses the existing assignment command, including legacy trackless assignments. Preserve backend sample invalidation semantics. No destructive profile management.
- Recognition is read-only. Loading, failed/unavailable recognition, missing calibration, no recording, empty report, pending/failed processing and no speakers have explicit localized states. Direct users to Transcript for processing actions; do not claim installed policies or calibrated automatic quality.
- Refetch processing after every mutation, including partial optional enrollment failure. Prevent duplicate mutations; ignore stale processing/recognition results and reset row state when meeting/job changes.
- A user gesture plays a representative nonoverlapping excerpt on the correct existing granted track URL with bounded start/end, pause and replay. Stop at the end, on another speaker, track, tab, meeting, job or unmount. Avoid overlapping playback, surface playback failures and never autoplay after stale async completion.
- Preserve transcript correction editing, processing configuration, historical job selection, legacy meetings behavior and existing recording ownership.

## Design and reference

Reuse interaction ideas only from pasrom pinned `a4f6af6df2674bc4e18097084a128af469823fab` (MIT), downloaded `SpeakerNamingView.swift` and `SpeakersSettingsView.swift` in `target/speaker-workspace-20261025/reference`. Speaker cards, one representative excerpt and known-name choices inform this implementation. No Swift code, thresholds or name-as-ID logic is copied. Backend research and calibration remain separately owned.

## Verification

Meaningful tests cover tab keyboard/focus, independent row selections, same speaker label across tracks, confirmed/suggested/unknown identity states, explicit false enrollment, create/select/correct/revoke, legacy revocation, historical and stale jobs, failed optional enrollment refresh, empty/pending/unavailable states, bounded playback/errors/switch/dispose. Run existing frontend regressions, full UI tests, TypeScript and isolated Vite output under the evidence directory. Preserve baseline files, exact incremental delta including untracked files, hashes and executed-versus-read evidence in `target/speaker-workspace-20261025/ui-r1`.

## R1 verification and pending gates

Frontend R1 is implemented using only the existing APIs. The final logic passed 496 UI tests across 72 suites, with 3 existing skipped tests, TypeScript, scoped Prettier and an isolated Vite build. A default-worker rerun hit the existing CalendarNavigation test's 5-second timeout; its isolated rerun and the complete 2-worker rerun passed without changing any timeout or assertion. See the evidence report for final wording verification and logs.

Parent acceptance remains pending: independent review; browser layout at 800px/1280px in both themes; actual granted-audio playback/pause/replay and error behavior in browser/native; native/capture integration. Mocked media tests do not prove audible playback. Recognition quality, noise, echo and other-track contamination are unmeasured by this frontend work. No claim of installed/calibrated automatic quality is made.

Selected-turn enrollment, profile/sample inventory and experimental manual comparison will be a separate R2, only after the parent's core contract and implementation are usable. R1 has no speculative DTOs or new IPC adapters. Future selected enrollment must reuse an existing confirmed assignment without reconfirmation and honor the documented assignment-revision guard.

## R2 selected voice curation integration (in progress)

R1 evidence stays immutable under `ui-r1`; the additive R2 baseline/delta lives under `ui-r2`. Integrate only documented spec 0078 IPC DTOs with camelCase responses and the existing snake_case `EmbeddingSpace.model_hash`. Identity confirmation uses enrollment false; explicit sample enrollment happens separately against the exact confirmed assignment with the list's `assignmentRevision` passed as `expectedAssignmentRevision`, without reconfirming identity.

- Selected enrollment is available after confirmation, loads candidates lazily, starts with no selected turns and requires explicit human provenance. Structural eligibility is distinct from acoustic cleanliness; noise, echo and other-track contamination remain unmeasured. Unsuitable/already-enrolled segments are visible but not selectable. All selections are cleared on reload, error, assignment/revision/job/meeting change or mutation reconciliation. Stale lists and stale async responses cannot authorize a new assignment. Batches contain only selected eligible IDs, capped at 128.
- Read-only private profile and per-person sample inventory retain compatible embedding-space grouping, active/revoked/invalidated state and counts. Individual active samples can be explicitly revoked with a required human origin; no profile deletion or consent defaults. Refresh inventory, candidates and comparison evidence after mutations.
- Experimental comparison is a separate read-only disclosure. Show `queryStatus`, each space status, candidates and score/support as raw evidence, not confidence or a `suggested` state. No candidate select/apply/confirm buttons or automatic person selection. Preserve empty, self-excluded, incompatible/no-history, invalid-history and truncated-detail states.
- Tests cover exact IPC argument casing/revision, independently selected turns, eligibility/reasons and unmeasured quality, no-reconfirm enrollment, stale assignment/revision/fetch rejection, failures/reconciliation, inventory grouping and explicit revocation, comparison never applying identity and all status/empty/error paths. Repeat full UI, typecheck and isolated build; browser/native/core integration remain parent gates.

R2 UX acceptance from parent browser R1 evidence: prioritize source/voice, excerpt, person, required human evidence and Confirm within each card. Display one concise honest global recognition status. Move repeated calibration, clustering and reprocessing details into accessible disclosures, keeping errors visible. Remove duplicate tab/title/intro spacing. Keep learning, profile memory and experimental raw comparison in separate collapsed areas. Preserve every consent/provenance prerequisite and theme/container behavior at 800px; parent browser verifies actual geometry.

R2 real-media correction: parent Chromium R1 probes showed a 2s–4s excerpt stopping at media time ~3.75s because the wall timer ignored playback latency. Add a regression that is red on frozen R1: advance wall time to the expected end while the media clock is behind, and require playback to remain active until media time reaches the bound. Timers must recheck currentTime and reschedule bounded remaining time, retain seek/rate/disposal safety, and stop/report indefinitely stalled media without spinning. Parent owns final real-media timing acceptance; do not widen timing assertions to hide early cutoff.

R2 mixed-label scope: an anonymous diarization group can contain multiple real people even without same-track overlap. Explain, before Confirm, that a name applies to all turns of that track + label and that uncertain/mixed groups may remain anonymous. Explicit selected samples train the private profile only against a confirmed matching assignment. Offer bounded per-turn listening before selecting/training; no default select-all and no splitting feature or acoustic-purity claim.

### R2 frontend verification and current gates

521 UI tests passed across 77 suites, with 3 existing skips; TypeScript, scoped Prettier and isolated Vite build pass. The media-clock regression is recorded red against R1 and green after the R2 correction, with lag, stall, seek/rate and disposal coverage. Full-suite tests use mocked IPC/media, not audible playback or acoustic-purity proof. R1 snapshots remain immutable; R2 evidence lives under `target/speaker-workspace-20261025/ui-r2`.

Frozen core DTO v1 SHA256 is `8e14ff11602cde4ef67c91d87f1e4df334f086eec8ad8f3ded41bf78c35383e9`. All 19 backend handoff file hashes match the backend source manifest. Backend validation artifacts report core 83/default and 87/local-processing passing, IPC worker smoke in both feature configurations, and strict clippy in four configurations. These backend checks were read and their pins verified by the frontend agent, not rerun. Combined browser/audio/native acceptance and independent review remain parent gates; no integration-ready or automatic recognition-quality claim is made.

## R3 independent-review corrections (in progress)

Preserve frozen R1 and R2, with a separate `ui-r3` baseline/delta. Address independent R1 findings against exact current R2 bytes before requesting complete parent acceptance:

- F2: queued pause events from an old stop cannot end a newly started same-track excerpt or native-player-to-excerpt switch. The pause handler must observe current paused state. Reproduce with asynchronous queued media events and stateful paused getter, not synchronous no-op media mocks; retain actual user pause/end handling.
- F3: transcript links restore seek + reveal/focus of the granted native track player without starting playback. Only explicit voice-excerpt controls use bounded playback. Keep transcript and voice actions separate in session and legacy utility. No hidden-focus target.
- F4: person, human-evidence and unsubmitted selected-sample/provenance drafts survive People -> Transcript -> People, while audio stops. Keep the review mounted and hidden; reset on actual job/meeting or assignment/revision reconciliation as before.
- F5: the first report becoming available must not stop a fresh gesture or clear newly entered text. Stop/reset on actual job changes before the next paint; initial-load and report-object-only effects cannot cancel a fresh excerpt.
- F6: homonymous people use distinct short UUID suffixes without merging identities or inventing aliases.
- F7/F8: avoid recognition refetch solely for a new object of the same report; deliberately invalidate after curation. Keep accessible excerpt toggle names stable while pressed state and visible play/pause text change.

Record red/green on exact previous bytes, meaningful UI/media-queue tests, full UI/typecheck/isolated build and fixed-file pins. The prior real-media R1+R2-hook proof closes only F1 for its pin; F2 and complete R3 still need parent browser/native/review acceptance.

### R3 verification and handoff

F2 has two deterministic queued-event regressions red on the exact frozen R2 hook and green after the paused-state guard. F3/F4/F5/F6 have five regressions red on exact R2 source and green in R3. The complete focused R3 run passed 31 tests; the final full run passed 530 tests across 78 suites, with 3 existing skips. TypeScript, scoped Prettier and isolated Vite build passed. Additional green coverage verifies existing native-track playback survives transcript seek, same-job report cloning does not refetch recognition, and accessible toggle names remain stable. No media timing assertion or timeout was weakened.

R1/R2 artifacts remain frozen. R3 changes are separately pinned under `ui-r3`. Complete R3 independent review, parent queued-pause Chromium probe, real media end/switch/replay/seek/focus/draft checks in both themes and widths, and native/capture acceptance remain pending. The prior R1+R2-hook browser proof is not acceptance of F2 or the complete R3. Backend DTO v1 and its integration boundary are unchanged.

## R4 unchanged-identity confirmation guard (in progress)

Preserve frozen R3 and apply only a minimal frontend guard, with separate `ui-r4` evidence. The legacy confirmation endpoint increments assignmentRevision even for the same person/scope, invalidating previously selected samples. For an existing confirmed track + speaker assignment, disable Confirm/Correct and guard its click handler when the chosen person UUID equals assignment.person_id. Show one brief localized explanation that the person is already confirmed. Compare UUIDs, never names, so a real correction to another UUID (including a homonym) remains allowed. Initial confirmation, explicit selected enrollment against the existing assignment/revision and revocation retain their commands and prerequisites. No core/DTO/calibration change.

Record a regression red against the exact R3 SpeakerCard bytes and green after the guard: same UUID sends no IPC; a different UUID with the same name can be corrected; initial confirmation works; selected enrollment and revoke still work with unchanged confirmation blocked. Include spec/locales/test and exact minimal source delta/hashes. Parent tests this increment separately from its private R3 browser copy.

### R4 verification and handoff

The exact frozen R3 SpeakerCard regression run produced 3 expected failures and 2 passing control cases. After the guard, all 5 dedicated cases pass in English/Portuguese coverage, including unchanged UUID no IPC, distinct homonymous UUID correction, initial confirmation, and selected enrollment/revoke while unchanged confirmation is disabled. The focused regression group passed 29 tests; full UI passed 535 tests across 79 suites, with 3 existing skips. TypeScript, scoped Prettier and isolated Vite build pass. The minimal 5-file R4 delta is separate from frozen R3, with source/delta hashes under `ui-r4`. No backend, DTO, calibration, player, navigation or inventory implementation changed. Parent applies/tests R4 separately from the accepted private R3 browser copy; parent R3 real-media/browser evidence is not automatically R4 acceptance.

## R5 paged private inventory and typed curation errors (in progress)

Only integrate the frozen additive v2 contract (`backend-r2-contract/contract-v2.md`, SHA256 `cd5d968b871f440da8c8492248b7b558e37126a8f8a9e99752e14d9a599db9ee`). Preserve R1..R4 artifacts and all R4 confirmation/UUID, selected-enrollment/revocation and media behavior. Product inventory switches to `library_voice_profiles_page` (metadata only) and `library_person_samples_page` (exact v1 sample fields), retaining v1 adapters for compatibility. No summary/progress endpoint, backend/DTO/calibration change or automatic page draining.

- Profiles and each expanded person have independent explicit Load more actions, bounded default limits and opaque cursors. Respect server canonical order; never imply name/date ordering. An empty progress page with nonnull nextCursor is not completion. Display loaded counts and loaded-sample compatible-space counts/durations as partial until that scope's nextCursor is null. Never invent global totals from profile metadata or one sample page.
- Bind each page to request scope and generation. A first sample page must also match the generation of its visible people metadata; any known mismatch invalidates both views before rows can authorize a mutation. Single-flight requests and item-ID deduplication prevent duplicate append. Late replies from a changed person/version/refresh cannot append. A generation mismatch or refresh-required keeps the loaded view visibly stale and disables page continuation/mutations until explicit restart with cursor=null. Successful mutations invalidate loaded pages; no cross-generation append. A fresh loaded row may still be revoked when comparison/enrollment are at capacity.
- Localize the exact stable first-line codes capacity_exceeded, refresh_required, busy, inventory_row_invalid and cursor_invalid with actionable guidance. Preserve visible errors; unknown existing errors remain visible. Refresh-required clears stale comparison authority and requires explicit restart for affected inventory. Comparison success remains exact read-only v1, with no person preselection/apply action.
- Test multiple/interleaved pages, empty progress pages, duplicate IDs/repeated actions, independent scopes, late replies, mutation/generation restart, partial counts/durations, typed errors/retry and read-only comparison. Repeat full UI/typecheck/isolated build only for final source. Backend R2 is separately implemented/tested; mocked IPC tests here do not prove live integration.

### R5 verification and handoff

The final UI passed 563 tests across 81 suites with 3 existing skips, plus TypeScript, scoped Prettier and an isolated Vite build. The initial focused pagination/error/read-only comparison run passed 39 cases across 5 suites; the final full run also includes strict sample-to-people generation binding and propagation of person refresh-required errors; adapter and integrated curation tests also passed. Coverage includes explicit multi-page load, empty progress pages, independent/interleaved person cursors, deduplication, repeated actions, generation mismatch, foreign-person and late replies, stale-view mutation blocking, restart from null, partial loaded counts/durations, successful mutation invalidation, fresh-row revocation despite comparison capacity, exact typed error guidance in both locales, and unchanged experimental comparison success. No live backend IPC or browser/native acceptance was executed by this UI task.

R4 SpeakerCard remains byte-identical at SHA256 `16cd6acc9531cdf956d019c9cae566c076131f77e67a9c47e3a75e81b0e59e10`; the R3/R4 player remains byte-identical at `135b1aa151915d2b825dc202a1fcd9a86d8fdba6b075da925fb0d1cd40bfbc20`. Frozen v2 contract SHA remains `cd5d968b871f440da8c8492248b7b558e37126a8f8a9e99752e14d9a599db9ee`. R5 source/test snapshots and exact incremental hashes live under `ui-r5`; R1..R4 evidence is unchanged. Backend R2 tests/pins, complete assembled browser/native acceptance and independent review remain parent-owned.
