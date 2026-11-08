# 0090 — Recoverable processing publication

Status: in-progress
Phase: F1
Date: 2026-10-26

## Why

Spec 0088 needs safe automatic retries. A completed inference currently commits
private voice candidates, a public file, and the public result in separate steps.
Retry can generate new segment IDs and another artifact after a partial failure.

## Contract

- Keep the exact validated result and prepared source identity in a private
  publication intent, atomically with its processed voice candidates. Never put
  embeddings or model paths into the public artifact or public meeting database.
- A pending intent is immutable. Retrying publication uses that same result and
  IDs without running inference again. A different result for the same pending
  job fails explicitly; it cannot replace the pending delivery.
- Validate the original source/configuration again before resuming. Failure keeps
  the intent and all raw audio. Do not silently accept changed or missing audio.
- Publish the derived public artifact at a stable per-job path/ID. Atomically
  install only a fully flushed file; an existing matching artifact is reused.
  A conflicting file, symlink or database row is preserved and reported, never
  overwritten. The artifact row is inserted idempotently only after file integrity
  and ownership checks. Temporary derived files are not claimed as publications.
- Store public result and succeeded state in one meetings.db transaction; remove
  the private intent only after that commit. A crash after success needs cleanup,
  not a second inference or a replacement public result.
- Keep succeeded human edits, assignment history and all prior jobs intact. This
  increment does not reconcile text between different jobs or enable reprocessing
  automatically. Successful publication still has the original job identity.
- The existing library lock serializes writers. This protocol converges across
  its files/databases after restart; it does not claim a distributed transaction
  or protection against arbitrary external SQL/filesystem modification.

## Storage and compatibility

- profiles.db migrates from v3 to v4 with one private processing_publication table.
  meetings.db remains v5. Old tables/rows and raw bytes remain unchanged; the new
  private schema is included by the existing SQLite backup and excluded from export.
- Refuse future versions before either database migrates; rollback a failed v4
  migration without altering the v3 schema/data/version. Preserve hot-journal
  recovery. Existing frozen v3/v4 fixture bytes are not rewritten.
- Desktop and CLI retry pending publication before launching a new inference.
  Durable queue requests, startup scheduling, attempt tokens, persisted profiles,
  model adapters and call boundaries remain separate increments of 0087–0089.

## Acceptance

Temporary-library tests interrupt after private commit, file installation, artifact
registration and public commit; reopen, recover, resume and assert exactly one
artifact, unchanged segment IDs/corrections, private vectors absent from export,
raw hashes unchanged and no second inference. Test conflicting files/rows, source
changes, malformed intents, transactional rollback, a pending-publication backup,
and unchanged legacy schema/data through migration. Fault injection represents
these durable boundaries; native power-loss/filesystem acceptance stays separate.
