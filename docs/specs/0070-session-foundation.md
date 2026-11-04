# Spec 0070: Local session foundation

- Status: implemented in core; independent review and parent integration pending
- Phase: bounded foundation for user-approved 0068, after 0069 R6
- Source pin: HEAD `86d146af40583a388fcdff467e4f9f024ec5db01` plus dirty
  module snapshot `target/session-foundation-20261024/baseline/manifest.json`.
  Git HEAD alone does not contain the core. The snapshot precedes this spec/code.
- Owns: core session module, meetings migration, focused tests and this spec.
  No note/storage/UI/launcher/0069/frozen-source changes. No network or real vault.

## Domain and API contract

A session exists independently of recording, including before/during/after a
meeting with no audio. Its UUID is stable. Title, optional date/time strings and
status (`planned`, `active`, `completed`, `cancelled`) are user metadata, never
inferred from capture/jobs. Dates use explicit UTC `YYYY-MM-DDTHH:MM:SSZ`, validated
as real Gregorian dates; end requires start and cannot precede it. Unknown dates
remain absent. Existing meeting timestamps are creation provenance, not invented
scheduled dates. Session metadata never changes a meeting title/capture state.

`Store` APIs, with types exported under `store::session` (no lib.rs change):

- `create_session(NewSession)` creates a manual session, no meeting/raw directory,
  job, note or calendar request. Repeated explicit creates are distinct sessions.
- `create_session_with_id(uuid, NewSession)` supports retries using a caller-reserved
  non-nil UUID. Identical manual metadata returns the existing session and links;
  a different origin/metadata fails without overwrite, including after human edits.
- `list_sessions()` and `session(id)` return persisted metadata/references, with a
  deterministic creation order; missing detail is `None`.
- `update_session(id, NewSession)` edits metadata only, preserving identities.
- `session_for_meeting(meeting_id)` resolves the unique canonical link.
- `attach_meeting(session_id, meeting_id)` is additive and exact-pair idempotent.
  Missing IDs or either side already bound elsewhere fail without rebinding.
  Every backfilled/new meeting already owns a session, so this is not a merge API.
- Existing `create_meeting(title)` still returns a meeting UUID, and creates its
  session in the same SQLite transaction. Backfill/new automatic session IDs equal
  the existing meeting UUID (distinct entity namespaces); no old IDs are changed.
  `import_audio` publishes the meeting/session together using the same helper; only
  its final SQLite publication boundary changes, leaving audio handling intact.
- `create_meeting_for_session(session_id, title)` supports manual-first capture,
  atomically creating/linking a meeting without allocating a second session.
  Repeating with the same session/title returns the existing meeting without
  changing capture state/files. A different title fails; no merge/replacement.
- `bind_session_note(session_id, PersonalNoteRef)` stores a non-nil UUID and safe
  slash-separated vault-relative Markdown path under notes/ or daily/. References
  are write-once, exact-pair idempotent, unique by UUID and path across sessions.
  Different path for the same UUID is refused, pending explicit move reconciliation.
  No filesystem existence/ownership check or file creation is claimed here.

All writes use SQL uniqueness/FKs and guarded updates, not read-then-rebind logic.
Errors use contextual anyhow results, not stable desktop IPC error codes. No unlink,
delete, merge or replacement semantics. The existing library lock owns production
access; competing SQL writers still cannot defeat uniqueness/guard conditions.

## Storage and migration

Only meetings.db advances to v4. profiles.db remains v3; explicit database kinds
select schemas and maximum versions, independent of filename. Preflight refuses
unknown future versions in either existing DB before any schema migration in either.
Preflight opens existing files read-write so SQLite can recover a hot rollback
journal before reading user_version. Recovery can write database pages and remove
the journal, even if a later version check rejects opening the library. These are
permitted recovery writes restoring committed state, not permission to upgrade a
schema. A future version still prevents all schema migrations; a missing file is
not created by preflight. Stores are not a cross-database transaction; each database
migration is atomic independently.

One `session` table adds optional unique meeting FK, optional unique paired note
UUID/path, metadata and creation provenance. A v3-to-v4 transaction creates the
schema and inserts exactly one session for each old meeting, preserving title and
created_at; dates remain unknown, status planned, origin recording. Reopening
cannot backfill duplicates. Existing meeting/jobs/artifacts/corrections, private
profile rows, raw bytes, note UUIDs/Markdown and board bytes are unchanged.
Fresh/older stores use existing migrations followed by the same v4 transaction.
A partial/conflicting v4 schema at user_version 3 fails closed and rolls back.

Externally malformed legacy titles that fail `length(trim(title)) > 0` also stop
backfill and roll back without rewriting titles or other user data. The SQLite
CHECK error is actionable by first backing up the closed library and identifying
row IDs with `SELECT id FROM meeting WHERE length(trim(title)) = 0;` on an isolated
copy. An explicit owner-approved repair is required before retrying. There is no
automatic fallback title, repair API or user-facing repair flow in this increment;
the parent owns that follow-up. Existing Store creation APIs already reject blank
titles; this limit concerns externally written legacy rows.

Disposable binary fixtures are generated by executing the captured pre-change
v3 Store implementation, not by copying current DDL. Fixture provenance includes
source hashes, generator and database/raw hashes. Tests compare every old table
and schema definition plus files before/after upgrade; repeated open, transactional
rollback/future versions/competing constraints and SQLite library backup are covered.
The existing SQLite backup automatically includes sessions, not referenced Markdown;
full vault backup remains a separate responsibility. No automatic operator migration
or backup is performed in validation. Deployment backup/recovery stays parent-owned.

## Provider identity design, deferred adapter

No calendar tables or heuristic importer ship in v4. A later explicit adapter must
use `(provider, stable account ID, identity kind, immutable event ID)` for single
instances, never scheduled start alone. Recurrences need stable account + series
identity + original occurrence start normalized using its source timezone, distinct
from mutable scheduled start. Provider aliases must be scoped to provider/account,
uniquely reference one session, and be added without silently rebinding on conflict.
Moved single events retain identity via immutable ID/aliases. Ambiguous or missing
identity fails to reconcile, rather than merging by title/date/attendee similarity.
Actual Graph timezone/occurrence normalization and alias schema require adapter
fixtures in the next increment. No attendees, voice profiles or account secrets
move into meetings.db, exports or sessions.

## Deferred integration and acceptance boundary

Personal note creation/binding must be orchestrated by the root backend with a
durable intent reserving UUID/path and recovery that verifies file identity/content.
The frontend cannot coordinate a cross-database transaction. This increment only
stores references; it does not prove note existence, durability or canonical identity.
0069 remains responsible for note identity. No analysis, summaries, chat, cloud,
autocapture, automatic note creation or calendar import is included. UI/sidebar,
IPC contracts, index documentation and native acceptance remain parent-owned.

## Acceptance exercised by core tests

- Manual sessions round-trip without audio; metadata changes retain links.
- Legacy v3 data/schema/files remain identical except v4 schema/backfill.
- Automatic creation/backfill produces one session per meeting, repeated open safe.
- Exact reattach/rebind succeeds; other bindings and missing IDs fail atomically.
- References survive restart/backup and cannot be shared or rebound silently.
- Transaction failures leave no half-session/meeting/schema/backfill/version.
- Both DB version ceilings fail closed, profiles remain v3.
- Concurrent note/meeting claims resolve to one winner with persisted invariants.
- All core tests run alone with a private Cargo target; no native app/operator vault.

## R1 executed validation (2026-10-24)

`CARGO_TARGET_DIR=target/session-foundation-20261024/cargo cargo test --offline
--locked -p coxinha-core`: 56 unit tests and 1 process recovery integration test
passed. The existing opt-in real speech/identity fixture test remains ignored;
no native, model quality, OAuth, UI or operator-vault acceptance is claimed.
`rustfmt --check` passed for the edited module roots and their child modules.
Correction of the original provenance wording (Fable R1 F-3): all 474 files inside
`approved-r6/source` match its immutable manifest. This is not a claim that the live
tree matches R6. At the R1 baseline there were three pre-existing parent status-line
changes in specs 0068, 0069 and specs/README; R1 then changed store.rs,
capture/imported.rs and processing/tests.rs. Those are the six live differences
against the R6 manifest. The pre-increment core baseline matches R6 core sources.
Original report, manifest, patch and logs are preserved; the explicit correction
and R1-to-R2 baseline/delta are under
`target/session-foundation-20261024/review-fix-r2/`.

## R2 crash-recovery correction (2026-10-24)

The R1 read-only preflight was a regression: SQLite could not recover hot rollback
journals and failed with extended error 776. Existing DB preflight now uses
`Connection::open(path)`. Its purpose is version validation before migration;
it is not a read-only operation. SQLite recovery writes may occur before a later
future-version refusal, but no schema upgrades may occur on that refused open.

Six regression tests supplement R1. Three kill a real child writer with spilled,
uncommitted pages on meetings v4, profiles v3, and the captured-v3 meetings DB
before v4 upgrade. A read-only control observes 776 for each genuine hot journal;
no journal is invented, copied, or renamed into place. Committed schema/all rows
are compared before/after recovery; uncommitted inserts, replacements and DDL are
absent after recovery. Repeated reopen is stable. Additional tests prove recovery
of an earlier DB is allowed before the other DB's future-version refusal, an
earlier future refusal leaves the later hot DB untouched, and future profiles
never cause a missing meetings DB to be created.

Before the fix, all three crash-recovery tests failed with 776. After the fix,
`cargo test --offline --locked -p coxinha-core` with its own target directory under
`review-fix-r2/` passed 62 unit tests and 1 process recovery integration test.
Two tests are intentionally ignored in the main suite: the subprocess-only crash
writer (explicitly launched/killed by its parent tests) and the existing opt-in
speech/identity fixture. Formatting passed. The R1 parent-owned Tauri 178-test
result was read as prior evidence, not re-executed or claimed as an R2 native run.
Original R1 evidence remains unchanged; R2 pins, delta and correction report live
under `target/session-foundation-20261024/review-fix-r2/`.
