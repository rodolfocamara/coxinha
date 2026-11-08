# ADR-0022: Reconcile orphan captures when the library opens

- Date: 2026-10-31
- Status: Accepted (authorized by the owner on 2026-10-31 with spec 0096)

## Context

`meeting.capture_state` moves `new → recording → finished | interrupted`. It
leaves `recording` only through `Recording::finish` or an explicit
`Store::recover_capture`. A crash, a kill, a power loss or an error inside
`Recording::finish` (before its `UPDATE`) leaves the row in `recording`
forever, because `Library::open` only runs `recover_jobs`.

An orphan `recording` row has three effects today:

1. The UI shows a permanent REC badge for that meeting, even after a restart
   (investigation in `docs/research/2026-10-31-frontend-redesign/recording.md`).
2. `jobs.rs` refuses to claim any `local-processing` job while a meeting is in
   `recording`, so transcription of every meeting stops without a message.
3. `store.rs` refuses backups for the same reason.

No capture survives the process: the capture subprocesses and the worker that
owns them die with it. At open, a `recording` row cannot belong to a live
capture.

## Decision

`Library::open` reconciles every `capture_state='recording'` row right after
`recover_jobs`, before serving requests.

1. For each orphan, run `Store::recover_capture`. It keeps the raw tracks,
   rewrites WAV headers to the frames on disk, computes digests, appends an
   "unclean shutdown" gap to the timing journal and marks the capture
   `interrupted`. This is the same code path as the manual "Recover" button.
2. If `recover_capture` fails (partial PCM frame, missing or unsupported
   manifest), set only the database row to `interrupted` and log a warning
   without file contents. The manifest and raw files stay untouched, so an
   explicit recovery remains possible later.
3. A reconciliation failure is logged and never prevents the library from
   opening.
4. The worker notifies the frontend of capture changes (`capture_changed`
   event) and reports `live` per session from `Worker.active`, so the UI never
   infers "recording now" from `capture_state`.

## Consequences

- **+** REC means a live capture, always. A crash can no longer block local
  processing or backups.
- **+** Recovery uses the existing, tested `recover_capture`; no new audio code.
- **+** The UI can drop the process-local acknowledgement cache that kept REC
  lit after interrupted captures.
- **−** A capture that the user would rather inspect before recovery is
  recovered automatically. Raw bytes are preserved and the state is
  `interrupted`, never `finished`, so nothing is promoted to success.
- **−** When `recover_capture` fails, the row says `interrupted` while the
  manifest still says `recording`. The detail view keeps offering "Recover",
  which runs the full procedure.
