# 0098 — Automatic transcription of recordings, calendar refresh and icon pass

Status: in-progress (P1–P4 implemented; the owner's backlog is running)
Phase: F1
Date: 2026-11-02

## Why

After spec 0097 the owner used the app and asked for four things:

- no button to transcribe: recordings, old and new, should get a transcript
  on their own;
- the best local model for full pt-BR batch transcription, and the existing
  recordings transcribed with it;
- the Outlook calendar already connected, since the Entra app is approved;
- the window close button is clipped, and the app should use more icons,
  starting with Settings.

## Non-goals

- Speaker attribution for the automatic transcript. Processing (diarization
  and voice matching) stays a separate, explicit step for now.
- GPU inference. The batch engine runs on CPU like the live one.
- Committing tenant or client identifiers. The repository is public.

## Design

### P1 Automatic transcription of recordings

- `LiveSettings.backlog` (default on) adds "Transcrever gravações
  anteriores" under Ajustes › Transcrição local. It only applies while live
  transcription is on and has a model.
- The library actor pumps a backlog (`src-tauri/src/library/backlog.rs`):
  - it runs only when nothing records, nothing processes and the live slot
    is idle;
  - every 20 s it lists finished or interrupted meetings and hands the
    choice to a thread, so the actor never reads transcripts or manifests;
  - the thread picks the newest meeting whose two tracks have a committed
    checkpoint and whose transcript is incomplete (`transcript_complete`);
  - the actor queues it through the existing "Transcrever o resto" path, so
    one model and one FIFO serve both live and batch;
  - a meeting still incomplete after its run is skipped until restart, so a
    broken recording never loops.
- A call or a manual processing run outranks the backlog
  (`LiveSlot::yield_backlog`): a running backfill is cancelled and resumes
  later from its cursor, because the transcript is append-only with
  dedupe-on-read. This closes the open "preempt a running backfill" item of
  spec 0097.

### P2 Calendar refresh

- Connecting Outlook is the opt-in. While connected, the cache refreshes 30 s
  after start and then every 15 minutes (`calendar/background.rs`).
- Auto-record reads `calendar::fresh`: when the cache is older than
  10 minutes it syncs first, bounded by 5 s, and falls back to the cache.
- The client id and tenant come from the existing build-time variables
  `VITE_OUTLOOK_CLIENT_ID` and `VITE_OUTLOOK_TENANT`, set only for the
  owner's local build. The first connection still needs one sign-in in the
  browser; OAuth consent cannot be done for the user.

### P3 Window chrome and icons

- The window buttons had `-mr-3`, made for the old header with `px-3`. The
  0096 strip has no right padding, so the close button crossed the rounded
  corner and was clipped. The margin is gone.
- Settings: one icon per section in the nav and on the section heading
  (`settings/icons.ts`), and an optional `icon` on `SettingsRow`, used by
  every row.
- Text-only buttons across the app get a leading icon by meaning (retry,
  cancel, create, import, connect, disconnect, sync, open agenda, open
  transcript, diagnostics, review, recover, prepare, details, ignore, load
  more), through the existing `Button` `icon` prop.

### P4 Batch model: Tagarela for live and batch

Benchmark on this machine (2026-11-02, CPU, 8 threads, transcribe.cpp; the
harness lives outside the repo): FLEURS pt_br 40 clips (read speech), CORAA
spontaneous pt-BR clips, long-form windowed CORAA, and 10 minutes of a real
meeting through 10–20 s windows (agreement only, no reference; the copies
were deleted).

| model | WER FLEURS | WER CORAA | long-form CORAA | RTF CPU | peak RSS | timestamps |
|---|---|---|---|---|---|---|
| Tagarela (parakeet v3 pt-BR, Q8) | 4.5% | 12.6% | 15.8% | 0.15 | 1.3 GB | word |
| parakeet v3 Q8 | 4.7% | 20.3% | — | 0.11 | 1.3 GB | word |
| parakeet-ultra Q8 | 3.6% | 21.1% | 22.4% | 0.11 | 1.3 GB | word |
| whisper large-v3-turbo | 3.9% | 22.9% | — | 2.53 | 1.0 GB | segment |
| Cohere Transcribe Q5 | 4.4% | 21.0% | — | 0.33 | 3.0 GB | none |
| Qwen3-ASR 1.7B Q8 | 4.9% | 21.5% | 25.7% | 0.50 | 3.5 GB | none |
| Canary 1B v2 | 4.8% | 25.5% | — | 0.17 | 1.9 GB | none |
| Granite Speech 4.1 2B | 7.3% | 67.2% | failed | 0.68 | 3.4 GB | none |

On read speech every model is within about one point. On spontaneous
speech, the case of meetings, Tagarela is 6 to 13 points better (95%
intervals exclude zero for every pair), runs 0.15× real time on CPU and
gives word timestamps, which the windowed engine needs. One model therefore
serves live and batch, and the backlog uses the live model setting.

## Acceptance

- [x] With live transcription and backlog on, an idle app transcribes the
      newest incomplete recording without any click; a failed one is not
      retried in a loop (`backlog::tests`).
- [x] A capture start or a processing request cancels a running backfill
      before queueing (`LiveSlot::yield_backlog`).
- [x] The backlog switch saves and is disabled while live is off
      (`live.test.tsx`).
- [x] The calendar cache counts as stale after 10 minutes
      (`calendar::tests`).
- [x] The window buttons carry no negative margin (`WindowChrome.test.tsx`).
- [x] Every settings section has a nav icon and a heading icon
      (`SettingsHub.test.tsx`).
- [x] Batch model chosen from the benchmark (Tagarela).
- [ ] The owner's existing recordings transcribed by the installed app.
