# Coxinha usability audit, 2026-10-23

## Initial findings (before this increment)

- Window close deliberately hid the window; tray Quit emitted BeforeQuit and waited 600 ms. This was an obsolete product rule, not an operating-system failure. A timer did not prove durable note saving.
- The running earlier artifact did not include the navigation fixes. New artifacts must have unique filenames/build identifiers; a successful build does not update an already-running process.
- Frontend exceptions were not persisted. An old TanStack failure cannot be reconstructed from nonexistent logs. Fixture note slugs caused a reproducible UUID error but are not proof of the user's exact click.
- AgendaPanel consumed hardcoded April events. AgendaView created a daily note on opening. Neither behavior is Outlook synchronization.
- NoteDetailRoute displayed an unconditional SavedIndicator. Note editor reuse and stale query content require regression coverage when switching notes with pending saves.
- Board references cannot rely solely on note UUIDs: rebuilding the existing note index replaces UUIDs. Preserve Markdown paths for reconciliation; unresolved references must remain recoverable.
- Search/new meeting controls in the rail and asynchronous settings failures require explicit UI review. Silent buttons and infinite loading are not acceptable acceptance states.

## Inspected design references

| Reference | Pattern selected |
| --- | --- |
| [Fireflies](https://mobbin.com/screens/8c289a95-1e9a-4340-9439-3102c794ded9) | Explicit stop-and-save confirmation with a keep-recording alternative. |
| [Lightfield](https://mobbin.com/screens/41a4a338-1606-4667-859e-94782b4eb885) | Recording state alongside transcript and meeting context. |
| [ClickUp](https://mobbin.com/screens/569bde32-22c9-447e-b9ca-a9c86be310fe) | Activity cards, colored notes and dependency arrows on a free canvas. |
| [Fibery](https://mobbin.com/screens/f4e8d90d-b2d1-477b-86a9-2fe31a4bf9ac) | Colored areas grouping items on a whiteboard. |
| [Grain](https://mobbin.com/screens/dfde47ec-d05a-4852-b359-3856ce439f7c) | Chronological upcoming meetings and explicit per-meeting recording controls. This is a layout reference, not authorization to copy bot behavior. |

React Flow is MIT-licensed and offers keyboard interaction, nodes, edges and pan/zoom. Sources: https://reactflow.dev/index and https://reactflow.dev/learn/advanced-use/accessibility. Existing Markdown remains authoritative; the board is separate canonical local metadata.

## Outlook contract sources

- https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0: calendarView expands occurrences/exceptions within a time window; delegated Calendars.ReadBasic is least privilege.
- https://learn.microsoft.com/en-us/graph/outlook-immutable-id: immutable IDs are case-sensitive and mailbox-scoped; send the preference on each request.
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow: authorization code with S256 PKCE and one-time state, a registered public desktop client, explicit sign-in, and no embedded client secret.

No production OAuth client, tenant consent, real calendar retrieval or hardware capture acceptance is implied by these references. Attendee names remain candidate context, never confirmed presence or identity.

## Verification boundaries

T3 preview navigation succeeded but snapshots failed twice with `Preview automation snapshot timed out after 15000ms.` Browser checks therefore use the repository's documented Playwright workflow. Browser IPC fixtures prove frontend behavior only. Native persistence tests, native build, real audio capture and human acceptance are separate evidence.

## Implemented increment

- Shared explicit native exit flow for the window and tray. Notes and the board report real save acknowledgement. Permanent save failures and delayed acknowledgement offer retry, cancel, or an explicitly warned exit that discards unsaved edits while preserving raw recording files for recovery.
- Per-note serialized save/deletion sessions, a component-level gate before reopening cached notes, read-only editor during exit, and conservative attachment handling. Failed saves remain available for retry. Opening a note no longer rewrites its Markdown without a user edit.
- Local diagnostic categories with session/build identifiers and bounded rotation; settings and error screens expose the location. Diagnostic records exclude content and account/token details.
- Persistent board with colored visual areas, note cards, dependencies, keyboard movement, autosave on navigation, field validation and native recovery-copy export. Areas are visual annotations, not moving parent groups. Existing notes stay in Markdown.
- Explicit Outlook connection and manual synchronization, local cached occurrences and explicit copying of attendees as candidate names. It does not confirm identity, persist a meeting-event link or start recording automatically. Operator-owned OAuth configuration and live account authorization remain necessary.

## Integrated checks

Evidence is stored under `target/usability-validation-20261023/` (local generated artifacts, not committed).

| Check | Executed result |
| --- | --- |
| Full frontend suite | 168 tests across 34 files passed (`frontend-final.log`). |
| Full native library suite with local-processing | 117 tests passed (`tauri-final.log`). Includes shutdown saturation/recovery, note mutation barrier, calendar callback and secret-format cases, board atomic persistence. |
| Strict Rust Clippy | Passed with local-processing and `-D warnings` (`clippy-final.log`). |
| TypeScript and production frontend build | Passed (`frontend-build.log`); existing large bundle warning remains. |
| Actual ReactFlow + BlockNote + TanStack in Chromium | Keyboard selection/movement, color, dependency save, navigation during delayed note IPC, offline agenda and recovery from unavailable-note route passed (`browser-audit.mjs`, `browser-audit.json`, `browser-audit.log`). No uncaught JavaScript errors or horizontal page overflow. |

Browser checks use synthetic IPC fixtures, not the native credential store or native persistence. A real-browser regression reproduced a stale cached note despite a loader-only fix; the component gate fixed that specific reproduction. This is separate from the independent unit test of deferred persistence.

## Remaining acceptance and evolution

- Native window/tray dialog interaction on the user's desktop, physical microphone/system capture and Windows/WASAPI acceptance remain unexecuted. Linux build or synthetic tests do not establish those outcomes.
- Live Outlook OAuth, enterprise policy and OS credential-store acceptance need the installation's own public client and account authorization. Windows credential blobs larger than 2,560 bytes fail explicitly without truncation or replacement; no arbitrary token-length compatibility is claimed.
- Voice identity remains conservative without approved acoustic calibration. Invited names are candidates only. Existing local transcription is available, but diarization/identity quality is not accepted by this increment.
- Automatic recording, durable meeting-event association, background calendar synchronization, mobile/PWA, shared server and production packaging remain separate work. Automatic recording requires explicit configuration, device validation, duplicate prevention and cancellation.
- An attachment whose insertion never completes prevents a successful save acknowledgement; cancellation, recovery or explicitly warned exit remains available. Recovery files and orphaned attachment files are retained rather than silently deleted.

## Independent review record

- Fable board R1: fixed navigation autosave, real controlled-canvas keyboard selection, validation/error messages and double-click behavior. Root then exercised the real canvas in Chromium.
- Fable lifecycle R1: fixed permanent save failure trap, shared note queue/deletion, stale reopening, explicit raw-preserving fallback and saturated shutdown dispatch. Root found and reproduced the cached-route variation in the browser before the component gate was added.
- Fable Outlook R2: prior findings resolved; no new high-severity or security finding. Three low-priority observations remain: a rotated credential exceeding the Windows blob limit can prevent cache refresh after a successful fetch; malformed/oversized invitee fields produce a generic error; IPv4-only listener with localhost relies on browser address fallback. No live-account or Windows acceptance is implied.
- A final root review found that Tauri `AppHandle::exit` enqueues exit and returns. The note/board storage barrier now commits a terminal state under its exclusive guard; queued and future note/board mutations are rejected even after the guard drops. This does not make unrelated diagnostics, configuration or calendar writes part of the same barrier. A retained queued future regression proves this boundary.

Final lifecycle/board revalidation and the terminal-state delta review are recorded separately from the earlier snapshots. A reviewed snapshot alone does not prove later source changes.

- Fable terminal-state R3: no blocking finding in the pinned delta; all nine source hashes matched. Reviewer inspected runtime exit semantics and lock ordering; native tests and strict Clippy were executed by Sol/root, not by Fable.

- Fable lifecycle/board R2: the R1 high/medium findings were resolved; 44 focused frontend tests and three hypothesis tests were executed by the reviewer. Two additional recovery issues were accepted for correction: reopening a note after a persistent write failure must expose its retained text, and attachment-pending flush failure must reach the native dialog as a sanitized distinct reason. The reviewer also confirmed the board fixes. R3 separately covers the terminal-write delta absent from the R2 snapshot.
- The later full-suite rerun hit its orchestration time budget while every allowed CPU was busy with concurrent host work; its log is retained as `frontend-resource-timeout.log`. A subsequent run was stopped when the R2 recovery fixes changed the tested source (`frontend-superseded-r2.log`). Neither interrupted run is counted as passing final acceptance.

## Final recovery checks

The browser regression now also simulates `update_note` rejecting with disk-full, navigates away, reopens the note, verifies the exact retained Markdown in the read-only recovery panel, removes the fault and retries successfully. It never mounts an editable stale note during the failure. The copy/retry controls received a small visual spacing/focus-style adjustment after the R4 snapshot; their logic is unchanged.

The final full suite uses the new typed flush-failure contract: board geometry remains dirty and its local failure detail is retained, while the exit barrier receives only the sanitized `save_failed` category. The prior string-equality test was updated to assert this contract without removing the retention/retry assertions.

The recording shortcut now opens the recording controls, with a matching label; it cannot silently start capture. Duplicating a note waits for its pending write before reading and copying the current Markdown. Failed duplicate/delete actions report a local error.


## Final review and test artifact

Fable recovery R4 found no blocking issue and reran 26 tests across eight files successfully. It confirmed retained-note recovery, sanitized exit failure reasons and pending-write serialization. The final root checks remain 168 frontend tests, 117 native library tests, strict Clippy and production frontend/native builds passing. Browser checks use synthetic IPC. A known low-priority cosmetic issue remains: the global save-failure banner may require its own retry after a successful recovery-panel retry.

The final Linux executable is `target/usability-validation-20261023/coxinha-desktop-usability-v2`, build ID `86d146af4058-1792796449`, SHA-256 `6c4440d092d567072523c30b915f21b124a059f1a7b22386469edc079b380005`. The source hashes and installed artifact are recorded in `build-manifest.json` alongside the logs.

Run `/home/rcamara/Repos/coxinha/target/recognition-validation-20261023/launch-demo` to test this build. This launcher now selects the new executable and keeps the existing demo data/config/cache/vault paths. Its previous contents are preserved as `launch-demo.before-usability-20261023`; earlier executables remain intact. No user data was reset and no tenant configuration was changed. An already running process must be closed and reopened to use the new executable.
