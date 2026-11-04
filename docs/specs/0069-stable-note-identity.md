# Spec 0069: Stable note identity and lossless metadata

- Status: in-progress; R6 independently reviewed, native acceptance pending
- Phase: F1 foundation for 0068; no sessions or activity schema
- Baseline: `target/activity-map-plan-20261024/baseline/manifest.json` and
  `baseline/source/` (tracked and untracked files, no WIP commit)

## Contract

Markdown is canonical; the note index is rebuildable. New notes and explicitly
saved legacy notes persist their existing UUID in frontmatter. An edit keeps both
UUID and path. API `content` is always **body text**, never a metadata patch.
Creating a copy always allocates a fresh UUID even if the pasted body contains an
entire other note file. `get_note` returns the exact body, without the envelope.

The supported envelope is deliberately explicit, refining the previously
unimplemented optional YAML proposal in vault-schema.md:

```markdown
---
coxinha-note: 1
id: 018f3b5a-0000-7000-8000-000000000000
custom:
  nested: [preserved, verbatim]
---
# Exact body starts immediately after the closing delimiter's newline
```

The opening delimiter must be the first line; the very next line must start
`coxinha-note:`. LF and CRLF are supported. No BOM or leading whitespace is
recognized. The marker must be integer 1, `id` a non-nil UUID string, and the
header one valid YAML mapping. Duplicate keys (including nested keys), malformed
YAML, missing/invalid IDs, and unsupported versions fail with an error. YAML
merge keys are unsupported. The closing delimiter is an unindented `---` line
with a terminating newline. Header lines are never trimmed, reserialized or
silently discarded. Unknown values, including nested maps, block scalars,
comments and original line endings, survive edits byte for byte. Future session
and activity metadata can use those fields; this increment interprets neither.

Unmarked `---` documents, generic YAML frontmatter, horizontal rules, fenced code,
and content beginning `---` are legacy **body text**, preserved verbatim. This
reserved-marker policy prevents heuristics from eating Markdown. Existing vault
files could not have acquired Coxinha metadata from the old raw-Markdown writer;
importing generic frontmatter as metadata is a separate explicit future feature.
The reserved prefix at byte zero opts an external file into the envelope contract;
invalid envelopes fail rather than falling back and hiding an error. API writes
wrap even a body starting with that exact prefix, so pasted metadata cannot
replace the persisted identity. Only the outermost envelope is interpreted.

## Rebuild and recovery

- Opening a vault performs no migration or file rewrite. Rebuild never writes
  note files. Existing IDs are retained by relative path before replacement.
- Priority: canonical envelope UUID, unclaimed prior index UUID for an unmarked
  file at that path, deterministic legacy fallback. Read and parse each file once
  into preflight entries. Reserve all canonical UUIDs and every legitimate retained
  legacy prior UUID before allocating fallback identities, in sorted relative-path
  order. A canonical identity is never reassigned. Preserve an envelope's previous
  `created_at` by UUID even after an external move; replacements use their own
  filesystem creation time, not the stale row at the reused path.
- Generation zero remains SHA-256 of `coxinha:legacy-note:v1\0` plus the UTF-8
  vault-relative path (`/` separators), truncated to 128 bits with UUID v8 and RFC
  variant bits. If an unassigned legacy fallback is reserved, select the smallest
  free generation `n >= 1`, hashing the same bytes plus `\0generation:` and the
  decimal integer `n` (no leading zeros). Reserve each allocation and warn about
  disambiguation. This applies only to unmarked fallback IDs, never envelope IDs
  or legitimate retained priors. It covers saved legacy notes moved away while a
  new daily, ordinary note, or restored pre-save backup reuses the old path.
  Repeat rebuilds retain both identities without Markdown rewrites; a lost index
  recovers generations from the on-disk canonical claims. Legacy unpersisted
  arbitrary prior IDs remain unrecoverable after index loss as described below.
- Two files claiming the same canonical envelope UUID still fail explicitly,
  independently of scan order. No note is skipped to conceal an identity conflict.
  Rebuild replaces notes, FTS and links in one SQLite transaction only after all
  preflight validation succeeds. Malformed metadata and publication failures leave
  the previous index intact. Invalid UTF-8 retains the existing counted-skip
  behavior. No indexing step rewrites Markdown. Preflight is a parsed snapshot,
  not an OS-wide atomic filesystem snapshot.
- With a lost index, persisted UUIDs survive moves and renames; legacy paths
  deterministically recover their fallback. A legacy note renamed before its
  first explicit save has no durable identity and can change UUID. A previously
  random legacy UUID cannot be recovered after index loss. Save first if external
  references must survive that loss/rename. No automatic vault migration.
- Title, tags, full-text search and backlinks derive only from body text. Unknown
  header fields are opaque and do not contribute index terms.
- Daily-note open checks disk when absent from the index. Import of an existing
  daily runs the same read-only preflight and deterministic allocator as rebuild
  across `notes/` and `daily/`, even with an empty or partially populated index.
  Canonical claims, legitimate prior IDs and sorted fallback allocations come
  from the same single parsed snapshot per file. Only the requested daily entry
  is published; other notes, FTS and links are not refreshed. No implicit rebuild
  or Markdown rewrite occurs. Malformed metadata or true canonical duplicates
  refuse the entire import before publication, with localized stable IPC codes.
  Ordinary indexed daily opens and brand-new daily creation do not scan the vault.
  Import reads every relevant Markdown file once, loads indexed prior rows,
  sorts paths, and holds parsed bodies in temporary memory. Fallback allocation
  checks successive reserved generations. It holds the
  existing permit -> note_writes locks without reentering them. Invalid UTF-8 in
  unrelated files retains rebuild's skip behavior; a skipped requested daily
  fails with its original read error and is never created/replaced. Newly created
  dailies persist IDs.
- All note mutations and rebuild serialize inside the existing desktop shutdown
  permit, held through file persistence and index publication. Save failures
  propagate; failed filesystem writes must not change the index or old file.
  Filesystem and SQLite are not one transaction: after a successful file write
  and failed index publication, an explicit rebuild recovers canonical bytes.
- Before update, read, indexed daily open, or delete of an unmarked file, require
  its exact current body bytes
  to match the single last indexed `notes_fts.body` row for that UUID. Missing,
  duplicate, unreadable or different indexed content fails closed with stable IPC
  code `note_file_changed_externally`. This protects a replacement at a stale path
  before manual rebuild. Unchanged legacy first-save and explicit header removal
  with unchanged body still work. A different envelope UUID at the indexed path
  fails with `note_file_identity_conflict`. Both checks use the same shared guard.
  Verification completes before exposing a body/identity, replacing a file,
  removing a file or removing any index row. Rejection preserves bytes, index,
  FTS and links.
- A missing expected file still fails with `note_file_missing_or_moved`, including
  deletion of a known indexed UUID. Failed deletion retains the index so an
  external move can be recovered by explicit rebuild. Deleting an unknown UUID
  remains idempotent. No old
  path is recreated and no alternative file is automatically found or overwritten.
  The stable codes reach localized retained-text recovery, including after
  editor remount. External-body or identity conflicts require copying pending text
  and explicitly reconciling files/rebuilding; retry alone cannot resolve them.
  A rebuild is an explicit acceptance of the current file set as index truth, not
  an automatic conflict resolution. Known note-file route/recovery errors offer a localized link to the existing
  Settings index rebuild section. Following it only navigates; retained text stays
  in the per-note queue across navigation/remount. The user can return to the note.
  The recovery screen never triggers rebuild,
  duplicate creation, overwrite or file recreation. Unsaved text lives in the
  running app until copied or successfully saved; discard/restart can lose it.
- The headerless-body comparison is a pre-write guard, not a filesystem CAS. An
  external process can still replace/edit a file after the comparison and before
  atomic rename, and same-UUID envelope body edits are not version-checked. No
  whole-filesystem compare-and-swap or external writer lock is claimed.

## Routes audited

`create_note` / `update_note` / `get_note` are the common IPC/editor paths.
Frontend duplicate waits for saves, reads body, creates and updates a fresh note.
Retitling uses update and keeps the path; external rename recovers the envelope
UUID on rebuild. Import/scan uses rebuild; Obsidian detection is read-only.
Daily creation shares the same codec and indexing helpers. Backlinks continue to
resolve title/path stem; no new session links, schema or worker. R3 extends only the
existing recovery screen's localized missing/moved/external-conflict explanation and its
failure handoff; navigation, note editing and recovery actions keep their layout.
The retained save queue refreshes its writer callback on editor remount so errors
reach the current recovery owner rather than a previously unmounted editor.

R4 shares the update guard with `get_note`, existing daily lookup and deletion.
The helper takes no locks; daily already holds the mutation permit and note writer
mutex, so it does not call the public locking read recursively. Mutations retain
permit -> note_writes order. `get_note` holds only note_writes around index lookup,
filesystem read and guard, preventing observation of an in-app FS/index split or
rebuild while allowing read-only inspection during the desktop exit barrier.

Same-UUID envelopes may expose current externally edited Markdown even if FTS is
older; that is the current Markdown contract, not revision/CAS protection. The
headerless exact-body check cannot distinguish deliberate header removal from an
identical replacement. Any external file replacement after verification and before
rename/unlink remains a race; no whole-filesystem CAS or external writer lock is
claimed. Known route-load and delete conflicts show localized operation-neutral
guidance using the existing stable codes, without automatic rebuild/search/rename.
The global save-failure signal/exit gate remains unchanged; a generic banner may
coexist with note recovery. Native/browser acceptance remains with the parent.

## Acceptance and validation

Disposable tests cover two rebuilds, empty/reopened index, prior legacy UUID and
unchanged legacy bytes, deterministic fallback, explicit legacy save, rename,
unknown nested/raw metadata, exact body including CRLF/`---`/fences, pasted ID
injection and duplicate flows, duplicate UUID files, malformed headers and nested
duplicate keys, atomic index rollback, filesystem save failure, existing and new
daily notes, metadata exclusion from title/search/tags/backlinks, and existing
terminal-shutdown/barrier tests. R4 adds identical red-before/green-after stale
read/daily/delete/missing proofs, rejection byte/index/FTS/link snapshots, explicit
rebuild recovery, unchanged legacy/read/delete compatibility and the in-app read
serialization observation window. R3 adds red-before/green-after ordinary-note,
daily/archive and backup-restore proofs, generation reuse/index-loss coverage,
retained-prior reservations, stable conflict recovery and UUID creation-time
retention. Existing R2 regressions cover stale prior-path identity
reuse in both filename orders, repeated rebuilds without rewrites, true copied
UUID conflicts with atomic failure, and missing/moved-file recovery without
recreation or loss of retained text. No operator vault or running launcher is used.

Run focused Rust tests in a standalone harness importing the real Storage/Db
source with an isolated `CARGO_TARGET_DIR`; full app commands and any unexecuted
integration checks are recorded in the increment evidence under `target/`.

## R5 review follow-up

R5 unifies every existing-file identity-allocation entry point with read-only
preflight; no import helper exposes generation-zero entries before reservation.
The DB's same-UUID/different-path save conflict is typed and mapped specifically
to `note_file_identity_conflict`; unrelated I/O and SQLite errors retain their
existing diagnostics. Metadata parse failures map at the note IPC boundary to
`note_file_invalid_metadata`, preserving internal error chains. R6 exposes only
safe path/category/position diagnostics. True canonical duplicates use the identity-conflict code.
No text matching or regex masks arbitrary errors.

Fable R3 F-3 remains a deliberate follow-up: a leading UTF-8 BOM does not opt into
the byte-zero reserved-marker contract. Such a file is unmarked Markdown, so a
rebuild may index envelope-looking text as body and index loss cannot recover its
embedded UUID as canonical metadata. Supporting BOM safely needs an explicit
codec/round-trip contract change and Windows-editor fixtures; R5 does not broaden
recognition heuristics. The existing arbitrary external-write race remains:
preflight is not a filesystem snapshot/CAS, and another process can change files
after reading and before publication or a later save.

R5 validation adds red-before/green-after daily import proofs for indexed archive,
empty index and partial index missing the archive row; sequential generation
reuse, retained prior reservations, explicit save/rebuild/index-loss continuity,
atomic malformed/duplicate refusal and ordinary absent-index daily compatibility.
UI tests cover the navigation-only rebuild link, retained-text remount and stable
localized metadata guidance. No native/full-app acceptance is implied.

## R6 actionable local diagnostics

R6 changes diagnostics only. The allocator, preflight policy, indexed-file guards,
locking and file/index mutation behavior remain unchanged. The String IPC result
keeps a known typed refusal code on its first line, followed by actionable detail.
Frontend classification uses only that exact first line for strings and Error
messages. A separate helper extracts detail, omitting the code from its display.
Unknown error prose is never interpreted as a note-file code; non-typed errors
preserve their full contextual cause chain, including invalid UTF-8 read causes.

Settings rebuild errors use localized rebuild-specific guidance, naming neither
an imaginary open note nor a guaranteed duplicate. Identity conflict guidance
covers both duplicated canonical claims and stale indexed paths, retaining safe
rejection until explicit reconciliation/rebuild. Detail identifies the affected
relative paths and cause as escaped plain text. Route and retained-text recovery
can display the same detail without adding mutation actions. The Settings heading
matches the rebuild link in English and Brazilian Portuguese. Navigation alone
still never flushes, discards, saves or rebuilds; retained text survives return.

Parser diagnostics sent to the UI or logs contain only safe metadata categories,
affected vault-relative paths, and available YAML line/column positions. They do
not dump scalar values, document keys or Markdown bodies from serde_yaml errors.
The original typed parser error chain remains available internally for debugging,
but no raw chain is logged or sent for metadata refusals. Diagnostics stay local;
no outbound telemetry is introduced. Canonical duplicate details retain both
paths; the stable code is not repeated in the displayed detail.

The accepted stale-index refusal and unrelated malformed-file daily blocking
remain unchanged, with actionable diagnostics. BOM handling, symlink refusal
wording, arbitrary external-write races/no filesystem CAS, and filesystem/SQLite
non-atomic publication remain follow-ups/limits. R6 does not broaden recognition
or allocation policy. Tests cover R5-red/R6-green detail loss, code recognition
with details, path/cause visibility, safe parser diagnostics, plain-text escaping,
localization and existing retained-text/navigation-only behavior. Full root/native
integration and a new Fable R5 diagnostic-delta review remain parent-owned gates.
