# Spec 0068: Meeting sessions and activity map

- **Status:** in-progress
- **Phase:** F1
- **Depends on:** 0058, 0059, 0060, 0061, 0064, 0065

## Why

The operator wants a single visual activity map and a sidebar of meeting sessions,
like the T3 Code session list. Home, Library, Agenda and Notes must not remain
competing top-level destinations. Each meeting occurrence owns personal notes,
transcript, summary and linked activities. Local background processing should
surface both work for the operator and commitments to follow up with others.
This supersedes the navigation choices of 0064/0065, not their desktop behavior.

## User experience

- Start on the activity map. Clicking the Coxinha brand returns to it.
- Sidebar: brand/collapse, search, new meeting, upcoming and past meeting sessions.
  Keep settings as a small utility. No horizontal icon strip or module menu.
- Meetings show title, occurrence date and an honest processing/recording state.
  Recurring events create distinct occurrence sessions with shared series context.
- Outlook contributes upcoming sessions and attendee candidates; it is optional.
  Manual meetings and imported audio remain first-class. Existing consent gates stay.
- A session has My notes, Transcript and Summary tabs, a persistent player/recording
  state, and contextual access to participants and activities. Notes work before,
  during and after a meeting, including meetings without audio.
- My notes are private, user-authored Markdown. Reprocessing never replaces them.
- The map is an infinite spatial canvas with colored areas, cards and typed links.
  It is not a mandatory Kanban. Preserve existing card positions and note content.
- Activity detail: description, status, responsible person when known, deadline
  when explicit, follow-up date, area/project and source meeting/segment references.
  Responsibility and who follows up are separate fields. Unknown stays unknown.
- Filters include My work, Follow up, Suggested and Completed without separate
  top-level pages. A compact review area receives newly generated suggestions;
  processing does not scatter or reposition existing cards.

## Local processing contract

1. A finished/imported meeting with a published transcript queues analysis.
   A changed corrected transcript can queue a new revision. No capture is started.
2. Use a selected local inference engine; no cloud fallback or automatic model
   download. With no configured model, expose Waiting for local model with retry.
3. Produce a versioned summary and structured action candidates grounded in exact
   segment identifiers and timestamps. Personal notes are not silently included;
   their use as additional analysis input is a separate explicit user setting.
4. Show candidates automatically on the map as Suggested. The user may accept,
   edit, dismiss or connect them. Do not present inferred ownership or dates as
   confirmed facts. Invitations and speaker labels do not prove identity.
5. Distinguish my action, someone else's commitment requiring follow-up, and
   unresolved ownership. Explicit profile selection identifies the operator;
   absent identity must not classify every first-person utterance as the operator.
6. Each run records meeting ID, transcript/correction revision, model identity,
   prompt/schema version and inputs. Retry of an identical run cannot duplicate
   suggestions. New revisions may suggest updates, never overwrite human edits,
   re-open completed tasks, resurrect dismissals or silently merge similar tasks.
7. Queue survives restart, supports bounded retries/cancel and reports failure.
   Resumption, inference and publication are separate states; publishing results
   is atomic/idempotent. Long inference must not block capture or desktop exit.
8. Meeting text is untrusted model input, not authorization for tool calls.
   Outputs are validated; citations must resolve to the exact input revision.
   No emails, reminders to third parties, external tasks or tenant writes.

## Storage and migration proposals to review

- Reuse canonical meeting IDs, immutable processing runs and durable core jobs.
  The legacy summarizer writes to a different meeting layout and is not assumed
  compatible with the current library merely because it exists.
- Persist extracted candidates separately from user-owned tasks. Suggested cards
  can be a projection of durable candidates, avoiding background rewrites of
  the user's spatial board file while it is being edited.
- Preserve Markdown as truth for personal notes and accepted/user-authored tasks;
  SQLite indexes and suggestion records carry provenance and processing state.
- Add stable session-to-note references and activity IDs rather than replacing
  existing note IDs. Existing board v1 and orphaned/recoverable notes remain
  reachable. Migrations require fixtures, backups and safe recovery semantics;
  no mutation of the operator's vault during development validation.
- Review whether accepting a suggestion can use the existing atomic note save
  plus an idempotent pending-publication record, rather than claiming a transaction
  spanning Markdown files and SQLite. Final design must prove crash recovery.

## Delivery sequence

1. Meeting session workspace: simplified sidebar, map default, per-meeting
   personal notes, transcript and honest summary placeholder; migration coverage.
2. Activity model and map: manual activities, responsibility/follow-up/status,
   source references, preserved layout and a Suggested review area.
3. Durable local analysis job: summary/action schema, model adapter, retry,
   deduplication, safe publication and grounded suggested cards end to end.
4. Calibration with public fixtures: wrong ownership, missing/relative deadlines,
   repeated commitments, corrections, unknown voices and changed transcripts.

Each increment is implemented by Sol 6.1, independently reviewed by Fable, then
integrated/tested by the parent. Keep rounded-window work (0067) isolated.

## Acceptance

- Existing notes/board/library open after upgrade without data loss or hidden
  legacy notes. Navigation and close/save behavior remain usable by keyboard.
- Two occurrences of one calendar event cannot mix notes, audio or actions.
- Notes survive restart, edits during processing, failed saves and reprocessing.
- A meeting produces a summary and cited suggestions on the map with a real
  configured local model; mocked extraction is not reported as quality acceptance.
- Retry/restart/reprocess cannot duplicate identical suggestions or overwrite
  accepted task edits/layout/status; dismissed suggestions remain dismissed.
- Unknown person or ambiguous commitment does not acquire a name/deadline.
- Accept/edit/dismiss and crash during publication are tested with disposable data.
- Processing never sends messages or publishes external tasks.

## Visual references inspected on Mobbin

- Amie, private notes/summary/transcript within a meeting session:
  https://mobbin.com/screens/9066c35a-a7fb-43d0-b81f-8ecb4d3cce5b
- Sana AI, action table with owner/deadline/source references:
  https://mobbin.com/screens/3ea1b2d6-e04e-4f6f-8d89-a75d0a4296cd
- Grain, timestamped speaker transcript alongside playback:
  https://mobbin.com/screens/360ddc40-494e-4028-ad6a-c2ad86c05091

These are visual references only, not claims about offline capability or licensing.

## Architecture review decisions (2026-10-24)

Fable reviewed the current dirty source and ran 14 focused core tests. Detailed
review: `target/activity-map-plan-20261024/review.md`.

- Accepted: stabilize note identity before session references; add a real session
  entity separate from recordings; retain personal notes as Markdown and board
  layout as user-owned v1 state; keep generated candidates outside board.json.
- Baseline requirement is met by an immutable source snapshot of 421 tracked and
  untracked files plus per-file SHA-256 at
  `target/activity-map-plan-20261024/baseline/manifest.json`. No WIP commit is
  required. Migration fixtures must be built from this captured pre-change code,
  never from the operator's databases. A Git HEAD lacking untracked files is not
  a sufficient baseline.
- Implement stable note identity as a separate increment (0069). Rebuild must not
  mutate legacy Markdown. Preserve unknown metadata and body bytes, explicitly
  reject conflicting metadata, and prevent duplicate IDs from hiding notes.
- Session identity needs canonical account/occurrence keys and provider aliases.
  Recurring original start must be normalized with its timezone. Do not use a
  mutable scheduled start as the sole identity for a moved single event. New
  calendar syncs cannot silently rebind existing notes or recordings.
- Accepting an activity requires recoverable publication. A pending record must
  reserve a stable activity/note ID and exact safe path. Reconcile must verify
  ownership/metadata and content at that path, not just file existence; it must
  never accept an unrelated or pre-existing file. Root-owned backend orchestration
  handles publication/recovery; the frontend must not be the transaction coordinator.
- Operator identification is explicit and private. Classification must account
  for confirmed speaker assignments and explicitly named owners; the person
  uttering an action is not necessarily the person responsible for it. Unknown
  ownership remains unresolved. No default assumption that microphone means me.
- Freeze corrected transcript and identity context per analysis run. Preserve
  existing processing identity keys when adding optional revision fields.
- Bound retries and prioritize recording over background analysis. Use cooperative
  cancellation/preemption with durable retry state; do not block starting capture
  for the duration of a background language-model run.
- The legacy summarizer cannot directly consume current library artifacts. A new
  analysis boundary is required, but an embedded llama.cpp dependency is not yet
  selected. Compare a strictly local configured engine adapter against embedded
  inference with an executable proof before introducing another native toolchain.
  No implicit cloud route, environment-key fallback or automatic download.
- Candidate identity rules require tests across corrected and retranscribed input,
  not only identical reruns. Do not equate string similarity with task identity.
  Human edits, completion and dismissal tombstones always win over model output.

The source snapshot is evidence for migration development, not a backup of user
content or proof that migrations are ready for the real installation.
