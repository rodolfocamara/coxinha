# 0088 — Visible local processing lifecycle

Status: in-progress
Phase: F1
Date: 2026-10-26

## Why

After Stop, the user cannot tell whether audio is saved, transcription is queued,
inference is consuming resources or the screen is merely fetching metadata.

## Non-goals

No synthetic progress, mandatory notifications, cloud fallback or promise that
closing the app leaves a hidden inference service running. No unrelated redesign.

## Behavior (acceptance)

- Separate recording durability, processing state and transcript availability.
  Stop acknowledges Audio saved only after durable finalization. A failed save
  must remain actionable and cannot be presented as a transcription failure.
- Expose a compact global status in the shell, session list and relevant session.
  It survives navigation, collapsed sections and reopening the processing view.
  Clicking opens job details without changing capture state.
- Distinguish Saved / Waiting for local model / Queued / Loading model /
  Transcribing / Identifying speakers / Ready / Paused / Retryable error.
  Optional summarization is a separate stage and unavailable until a configured
  local text engine exists. ASR completion does not imply summary completion.
- Display meeting title, current stage, actual runtime device (CPU/GPU or unknown),
  elapsed time and queue size. Device capability or an installed NVIDIA card is
  not evidence that a job uses GPU. Unsupported utilization metrics stay absent.
- While recording, show transcript lag in seconds and committed audio coverage.
  After recording, use processed unique track duration / total eligible track
  duration only when measurable; do not count overlap twice. Stage labels remain
  indeterminate when the engine provides no trustworthy progress.
- No ETA until enough measured throughput exists; label any ETA as an estimate.
  A metadata fetch spinner never substitutes for the durable worker state.
- Refreshing the same meeting/job keeps its prior successful data visible, including
  when the refresh fails. Switching meeting or explicit historical job hides the
  previous scope immediately; stale responses cannot repopulate it. Capture and
  processing labels remain independent if both are reported by the backend.
- A prior successful transcript remains available if a newer attempt is pending
  or failed. Display its version and the latest attempt's separate state.
- On first setup, explain During the meeting, After the meeting and Manual modes.
  Recommendation: local incremental mode after the benchmark gate in spec 0089.
  After-meeting mode schedules work on durable Stop when configured, without
  requiring the user to open the session. Missing models produce a visible wait.
- Queue work durably and deduplicate by input/model/configuration revision. On
  restart recover or visibly retry interrupted jobs; never announce Ready early.
- Persist the selected processing profile and mode in the backend. Scheduling
  failure after durable Stop is a separate visible condition, not a failed save.
  Manual mode or an absent profile never silently enables automatic inference.
- Claim each attempt with a distinct execution token. Requeue, retry and restart
  invalidate the previous token; checking only that a job is running cannot fence
  a late result after a newer attempt has already claimed the same job.
- User cancellation is terminal until explicit retry; shutdown/preemption is
  resumable; engine failures have a bounded retry policy. A stale recording row
  after crash surfaces Recovery required rather than silently blocking the queue.
- Automatic scheduling must not replace an existing successful transcript or
  hide human edits. Reprocessing remains explicit until revision adoption and
  source-anchored edit reconciliation are implemented.
- Pause and cancel apply to derived processing, never delete captured audio or
  manual edits. Retry cannot launch concurrent copies. If the current engine
  cannot interrupt safely, show Pausing after current segment rather than Paused.
- Capture has scheduling priority. A new explicit capture request must not be
  blocked indefinitely by old inference. Resume the backlog when resources permit.
  Never buffer unbounded audio in RAM to conceal insufficient processing speed.
- Closing follows ADR 0020: checkpoint/recover pending work, flush and exit. Show
  that pending processing resumes when Coxinha is reopened. Minimizing while the
  process is alive may continue work; exiting does not imply a background service.
- Completion/error notices are optional, deduplicated and contain no transcript
  text in OS notifications by default. All states and actions are localized.

## Design notes

Reuse the canonical jobs store and expose one consistent snapshot/event stream to
the shell and session views. Today `library::finish` finalizes capture only, and
`ProcessingPanel` explicitly requests processing. `library/processing.rs` exposes
validation/inference and excludes active capture. These are implementation gaps,
not claims that automatic concurrent processing already exists.

Specs 0087 and 0089 define boundary changes and the incremental scheduler.
The UI status increment may ship first against truthful existing states; do not
enable concurrent capture by merely deleting the current safety guards.

## Validation

Exercise stop/save/queue failures, missing models, navigation, late worker replies,
restart, shutdown during each stage, retry, two queued meetings and a new capture.
Assert capture ownership, old transcript retention and no duplicate publications.
Measure actual CPU/GPU execution before labeling it. Browser tests cover global
visibility and accessibility; native tests cover disk durability and contention.
Implementation authorized on 2026-10-26. Runtime acceptance remains pending.
