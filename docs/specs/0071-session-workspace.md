# Spec 0071: Usable session workspace

- Status: implemented and locally tested; independent review and parent integration pending.
- Scope: first vertical increment of approved 0068 on 0069 R6 and 0070 R2.
- Baseline: `target/session-workspace-20261024/baseline/manifest.json`, SHA256
  `60cf2fb72432d9f8e49b99109ea3f39ba1a7bb431c8e7f3d2ecdcc815f87b875`.
  All 499 tracked/untracked source files captured before this spec/code; HEAD
  `86d146af40583a388fcdff467e4f9f024ec5db01`, feat/0058-meeting-library.

## Product contract

Start on the existing spatial board/map. Brand returns to map. Sidebar contains
search, explicit new manual session, durable session list and settings utility.
No competing Home/Library/Agenda/Notes top-level module buttons. Existing note
routes/search/board stay available; agenda and capture/import remain contextual
utilities. Preserve sidebar collapse, focus, drag, resize and desktop exit.

Session title is the sole session display name, independently editable from old
recording titles. Session route has keyboard accessible My notes, Transcript and
Summary tabs. Personal Markdown uses the existing NoteEditor/save queue/recovery,
including no-audio sessions. Transcript, players, participants and processing reuse
the meeting library components and original job IDs. Summary explicitly reports
not generated; no analysis adapter, cloud request or fabricated result. No capture
on render, calendar sync, model download, voice export or transfer/attach UI.
Explicit manual-session capture creates a meeting through create_meeting_for_session
in the dedicated worker. Ordinary recording/import still auto-creates one session.

## Recoverable personal note publication

Meetings schema v5 adds a durable intent per session: reserved non-nil note UUID,
deterministic notes/session-<UUID>.md path, random ownership token, initial body and
state reserved/complete. SQL triggers protect reserved ownership against alternate
bindings, make reservation identity immutable and guard completion. Commit reservation before filesystem publication. Profiles
stays v3, both future-version preflights and hot-journal recovery remain unchanged.
The approved 0070 artifacts/pins remain immutable; this is a documented successor.

An idempotent backend command orchestrates worker reservation, lower-level Storage
publication/indexing, then worker binding/completion. Frontend never coordinates
create_note+bind. An owned Storage mutation permit spans all phases, survives IPC
caller cancellation, and is acquired before worker dispatch. Worker never waits
for Storage. Storage serializes publication/index with note_writes and does not
reenter the outer permit. Exit's exclusive barrier waits for the whole operation.
No filesystem/database global atomicity is claimed.

Write and sync a private temporary file; publish with exclusive hard-link (no
replace/TOCTOU overwrite), sync directory on Unix. Never overwrite/delete a target
on conflict. Envelope proves UUID, session ownership, reserved path, random intent
and initial-content digest. Existing files must prove all metadata, not mere
existence. Once published, retries index the current body and never restore the
initial text. Complete intents with missing files fail rather than recreating
user-deleted data. Interrupted reserved intents resume after restart. Stable UUID
moves are resolved from Markdown/index with ownership proof; duplicate claims or
foreign replacements fail closed. Binding path can follow the same UUID only via
this verified backend path. Per-session retry/errors do not block unrelated notes.
Startup reconciliation retries pending intents under the same barrier; conflicts
remain visible/retryable per session and do not prevent vault/library startup.

## Validation and boundaries

Disposable v4 fixture sourced from immutable baseline; migration preserves old
sessions, captures/jobs/edits/private profiles/raw. Cover reservation concurrency,
restart at each publication phase, foreign path, ownership tamper, unknown session,
user-edited bodies, moved/ambiguous UUID, completion retries and exit barrier.
Frontend covers map startup, session navigation/creation, honest empty/error states,
notes recovery reuse, tab keyboard behavior, processing mapping and explicit capture.
Run core/Tauri in isolated harness with private CARGO_TARGET_DIR under
`target/session-workspace-20261024`; frontend Vitest/typecheck/build with isolated
outDir. No native app, operator vault, shared Cargo target, launcher, network,
commit or push. Parent owns browser/native acceptance and independent Fable review.

## Implemented validation and provenance (2026-10-24)

Core: 65 unit tests plus 1 killed-capture recovery integration passed offline.
Tauri: 188 unit tests passed in the isolated source harness. One subprocess-only
publication crash helper is ignored in the main run and explicitly executed by
its parent at reserved/published/indexed/complete boundaries. Published/indexed
exits occur inside the real Storage publication path, without unwinding. Binding
and intent completion share one SQLite transaction, so there is no committed
half-bound intent window. Existing hot-journal tests still kill actual writers.
Frontend: 333 Vitest tests passed, typecheck and isolated production build passed.
Rich-text/native/inference boundaries are mocked only in focused UI tests; the
new retained-note test runs actual NoteEditor, persistence and recovery/save queue.
No model quality, native device or browser acceptance is claimed.

The original 499-file baseline excluded two ignored synthetic v3 database fixtures.
This inventory omission was discovered during isolated-test assembly. A separate
`baseline-supplement/manifest.json` captures their exact bytes after implementation,
verified equal to the approved 0070 R2 product pins. Neither original fixture was
edited. The original baseline remains unchanged; all 30 predecessor product hashes
match the baseline plus verified supplement. Narrow gitignore exceptions now keep
these synthetic v3/v4 databases in source inventories. The v4 fixture was generated
by compiling the immutable pre-0071 v4 Store against the existing v3 fixture; its
source/generator/DB provenance is recorded in `tests/fixtures/session-v4/`.

0070 documentation and review artifacts/pins stay unchanged. The successor delta
changes its core version ceiling/migration, session module registration and version
expectations/snapshot exclusions in existing migration tests. Profiles remains v3.
Legacy core-only note references without a publication intent fail safely and need
explicit recovery; the backend never silently adopts an arbitrary old note.
Exclusive publication requires filesystem support for persist_noclobber. Unsupported
filesystems fail with a retryable note error; there is no unsafe overwrite fallback.

Owned paths are enumerated, with before/after SHA256, in
`target/session-workspace-20261024/increment-manifest.json`. The backend uses the
existing dedicated-library invoke wrapper/Value IPC pattern and registers commands
in build_specta. The existing generated bindings file is preserved. No launcher,
shared Cargo target, root dist, operator data, network, commit or push was used.

## R2 embedded composition (2026-10-24)

Parent browser audit found unusable writing space with the real BlockNote:
1280x800 gave 477px content width beginning y591; 800x600 gave only 109px width,
beginning y698. This frontend-only correction uses an explicit embedded NoteEditor
variant for session notes. It hides standalone metadata/backlink chrome by default,
keeps the editable Markdown (including existing H1) unchanged, preserves the exact
save/recovery/action paths, and makes editor insets respond to its container rather
than viewport lg breakpoints. Standalone note routes keep their original composition.
The session title appears once in its heading; rename is an explicit action with a
form only while editing. Audio status is compact; capture/playback expand explicitly,
players remain mounted, and no capture or source enumeration happens on render.
Visible editor/action/backlink strings have English and Portuguese dictionaries.

R2 baseline is separate: `target/session-workspace-20261024/composition-r2/baseline/`.
It captures all 531 current tracked/untracked source files before R2, including the
synthetic DB fixtures, and copies the immutable R1 manifest/patch/report/verification.
All 60 R1 after pins matched at capture. No R1 artifact is overwritten. Backend,
protocols, launcher, root dist, vault, shared Cargo targets and the parent's browser
artifacts/server are outside this correction. Parent owns real browser remeasurement.


R2 also responds to `ui-review-r1.md`: shell remains stable between session routes
and only session content is keyed; an in-memory session list cache avoids remount
loading/refetch, and embedded initialization does not steal focused sidebar controls.
The returned capture meeting ID is retained with its session ownership while detail
refresh is pending/fails. Acknowledged Stop/Pause controls do not wait for metadata;
stale status polls cannot override a newer action. Failed refresh retains the last
loaded workspace. Settings map utility now uses `/`, with its own localized nav
label; finished recordings have explicit explanation; occurrence dates use app
locale; unused Rail props were removed. Note/Summary mount policy (F6) is unchanged.

F3 was not reproduced by capture: parent confirmed core dates/status are independent
user metadata, while capture updates meeting_id only. Existing full-record title
update is retained without pretending refetch-then-write is atomic. Before a future
concurrent metadata/Graph writer, introduce a title-only backend command (and the
appropriate concurrency contract). No backend/protocol/schema change is in R2.

Executed R2 checks: 352 Vitest tests in 56 files, typecheck and isolated frontend
build passed. Geometry after R2 with real BlockNote/browser/native remains the
parent's acceptance gate; no pixel measurements are claimed from jsdom. No Rust
or native test was run for R2. Parent reported a separate complete Cargo run with
perf_smoke peak 236.7MB over its 200MB limit, and strict Clippy failures in preexisting
0069 code; those are outside this frontend delta. R1 library test passes must not
be described as a complete Rust suite pass. Main is not authorized.

## Backend R2 review addendum (2026-10-24, written before implementation)

Scope is F1/F2/F3/F5/F6/F7/F8 of backend-review-r1. No frontend, locales,
launcher, operator data, schema, title API, performance budget or Git mutation.
The existing R1 and frontend R2 artifacts remain immutable. Before-source pins
and copies live in `target/session-workspace-20261024/backend-fix-r2/baseline`.

Native boot/performance/shortcut tests require a dedicated non-default feature,
are ignored even with that feature, and require explicit private-session owner
acknowledgment. A common harness creates a fresh temporary profile, constructs
an environment without inherited data-path overrides, and owns child kill/wait
through RAII. A validated application test profile routes vault/config/index,
library, logs and webview data into that root on Linux and Windows; standard
home/appdata/config/cache/temp variables are also private. Invalid/incomplete
profile configuration fails before app startup, never falls back to production.
Production defaults without the profile stay unchanged. Global hotkeys and OS
services require a parent-owned private desktop/session; path isolation alone
cannot provide this. This implementation runs only hermetic contracts and
`--list`, never a native app. perf_new_note is inspected for child launch.

A complete intent may take an ordinary-read fast path using the index UUID/path,
validated PersonalNoteRef, symlink-safe path and exact ownership envelope. It
reads that one file and does not update the index. As with existing get_note,
this path does not discover new duplicate UUID claims elsewhere in the vault;
it is not global recovery validation. Index miss/missing file uses the full scan,
which still rejects duplicates and never recreates complete missing notes.
Reserved/crash recovery always scans. Explicit rebuild remains full-vault
validation and refuses canonical duplicates atomically. Tests must demonstrate
both this limited normal-read guarantee and unchanged recovery refusals, plus
move/tamper/missing safety. No frontend avoidance or silent adoption is added.

Publication returns typed Conflict, Missing or Transient errors. Only proven
Conflict/Missing publication refusals can persist a session error. Worker busy,
shutdown, completion failures and I/O remain transient and never become durable
conflicts through string matching. Metadata diagnostics retain the safe existing
IPC boundary. Validate PersonalNoteRef before any index mutation, including
moves to invalid cross-platform paths. Quote newly emitted ownership strings
using the existing YAML parser; preserve parsing of existing envelopes without
broadening legacy detection. Legacy bound sessions without intent still require
explicit recovery and are never silently adopted. Fix the non-Linux unused
binding and the two mechanical preexisting 0069 Clippy findings.

Validation uses private Cargo targets and offline locked core tests, Tauri lib
only, strict workspace lib/tests Clippy and formatting. Native discovery is
checked only after gates exist. No claim is made for native performance (the
previous 236.7 MB > 200 MB remains unresolved), Windows execution, real desktop,
product acceptance or production readiness.

## Backend R2 deletion safety addendum (2026-10-24, before guard code)

UI R2-F2 exposed generic Trash hard-deleting the canonical personal note. All
production delete_note IPC callers, including command palette and standalone
note routes, must use a backend service that queries the canonical library for
both session bindings (including legacy bindings without intent) and reserved or
complete intents. Match UUID or the indexed file path; never trust editable
Markdown ownership fields as the protection source. Refuse protected notes with
the stable code `session_note_delete_requires_detach`. Unavailable/busy library
or failed protection query fails closed before any filesystem/index deletion.
Ordinary unbound deletion retains its identity/continuity checks and behavior.
No detach/delete workflow or automatic recreation is introduced.

Deletion takes Storage's exclusive operations barrier, checks shutdown, then
note_writes; it holds both through canonical worker lookup and filesystem/index
mutation. This serializes against the whole ensure_note reservation/publication/
completion permit, not only the file phase. The worker never acquires Storage.
An owned task retains the guard across IPC cancellation. Exit uses the same
exclusive barrier: an earlier deletion finishes before exit, and a deletion
queued behind committed shutdown refuses. The query is read-only; there is no
cross-database/global filesystem atomicity claim. External processes/direct SQL
writers that bypass this app's Storage gate remain outside the single-process
IPC contract, and external file deletion still yields durable missing rather
than recreation. No production raw Storage delete API bypass is retained.

Hermetic service-boundary tests must execute the same backend used by delete_note
IPC, proving complete/reserved/legacy and path-based references leave Markdown,
index/FTS/links, bindings and intents unchanged; an ordinary unbound note still
deletes. Cover library unavailable, ensure/delete serialization, cancellation
and the committed exit barrier without launching the desktop application.
Frontend/locales remain separately owned. Final union pins must be refreshed
only when the frontend R3 and backend changes have both stabilized; backend-only
pins cannot be described as the final integrated product tree.
