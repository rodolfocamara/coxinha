# 0097 — Automatic call recording, live transcript and meeting titles

Status: in-progress (P1–P2 implemented; P3–P4 revised after design review, implementation in progress, off by default)
Phase: F1
Date: 2026-10-31

## Why

The owner forgets to click Record. They asked for three things:

- a flag that starts recording when a Teams call is detected and stops it
  when the call ends;
- a semi-realtime transcript during the call (spec 0089);
- a title from a summary of the first minutes, refined at the end, unless a
  calendar event at the same time already names the meeting.

## Non-goals

- Bots or Teams/Graph meeting APIs.
- Cloud ASR or LLM. ASR runs on this computer. Title suggestions may use
  one user-owned host over SSH (ADR 0024), text only.
- Automatic voice enrollment.
- Recording while the setting is off. The off state behaves exactly like
  specs 0083 and 0087.

## Design

See [ADR 0023](../architecture/decisions/0023-opt-in-automatic-call-recording.md).

### P1 Automatic start and stop

- Settings › Gravação adds **Gravar chamadas automaticamente** (default off)
  and **Parar quando a chamada terminar** (default on). They are persisted in
  `app_data_dir/auto-record.json` together with the chosen microphone and
  computer-audio sources, so the backend can start without the webview.
  Turning detection off turns auto-record off. Turning auto-record on turns
  detection on.
- `auto_record::Policy` is pure and is fed by each detector poll:
  - A new episode with no capture and no processing running gives Start.
  - When the bound episode is absent, a stop is due 20 s later. The episode
    returning or a failed poll cancels it.
  - A new episode while the bound one waits for its stop gives Stop and then
    Start.
  - Otherwise a capture in progress is left alone; the strip's "Nova
    chamada" prompt handles it.
  - A capture the policy did not start, or a different active meeting,
    clears the binding.
- Executor: picks the devices (saved ones if they still exist, otherwise the
  system defaults), creates or reuses the session, starts it, sets invitees,
  then emits `auto-record-changed` and a native notification. If any step
  fails, it notifies and leaves the normal prompt in place. No retry loop.
- `auto_record_status` returns the settings, the binding (session, meeting,
  app, call key) and `stopAt`. `auto_record_keep` cancels the pending stop
  for the current binding and disables auto-stop for it.
- Strip: during the grace it shows "A chamada no {app} terminou · parando em
  0:18" with Continuar gravando and Parar agora. When auto-stop is off, the
  existing ended prompt is used.

### P2 Title from the calendar

- The cached Outlook snapshot (`outlook-cache.json`) is read locally. An event
  matches when it is not cancelled, not all-day, and `startsAt − 10 min ≤ now
  ≤ endsAt`. The nearest start wins; on a tie, the shorter event.
- A planned session without a recording, with the same title and a start
  within 30 min, is reused. Otherwise a session is created with the event's
  title and times. Invitees go to the participant context, the same as the
  manual flow.
- No match: the title is "Reunião no {app}" and the session is marked for P4.

### P3 Live transcript with Tagarela

Decided 2026-10-31: the user's Handy model
`parakeet-v3-ptbr-tagarela-matched-q8.gguf`. It runs on the transcribe.cpp
runtime, pinned to `transcribe-cpp = "=0.2.4"` with `default-features =
false` (no Metal), the schema the file was converted to.

Spike on this host (CPU only, synthetic pt-BR TTS clip):

- load in 0.56 s;
- 14.7 s of audio transcribed in 1.5 s;
- `supports_streaming: false`, so offline windows (spec 0089).

The engine has no mmap, so each process keeps its own copy of the weights
(~740 MB). Abort is only observed before a run starts (Parakeet
`model.cpp:969`).

Revised after the Claude Opus 5.5 design review of 330c10a, which found
blocking items B1–B5.

- **One slot, owned by the actor** (B3, B4).
  - The library worker owns a single `LiveTranscriber` slot, the same way it
    owns `ProcessingTask`. It holds one long-lived thread, one model and a
    FIFO of meetings to drain. The model is unloaded after 2 minutes idle.
  - The actor only spawns, sends messages and checks `is_finished()`. It
    never runs model load, hashing, file reads or joins.
  - Manual `Process` (Whisper and diarization) is refused while the slot is
    busy. A new capture during a drain only queues its meeting, so at most
    one ASR model is resident.
- **Explicit lifecycle messages** (B1).
  - After each successful checkpoint the actor sends `Committed{meeting}`.
    When a capture ends it sends `End{meeting, state}`, where `state` is
    `finished | interrupted | failed`. All three are terminal: the worker
    drains up to the last committed frame and closes the meeting.
  - The worker never polls the manifest to detect the end.
  - After a crash, nothing resumes automatically. The meeting page offers
    "Transcrever o resto", which queues the meeting from its last segment.
- **Durable output without a two-file protocol** (B2).
  - Each line of `outputs/live/transcript.jsonl` carries
    `{track, start_frame, end_frame, start_ms, end_ms, text}`. Lines are
    appended and fsynced per window.
  - Readers drop a trailing partial line and deduplicate by
    `(track, start_frame)`. Resume continues from the largest `end_frame`
    per track.
  - There is no cursor file. `outputs/` keeps `verify_raw` and deletion
    rules intact (N3). Deleting a meeting cancels and dequeues it first.
- **Windows.**
  - Fixed decode windows of about 10 s with 1.5 s of left context.
  - Only tokens that end before `window_end − 0.5 s` are committed, using
    the per-token timestamps of the TDT decoder. The rest is decoded again
    in the next window.
  - When the backlog grows, windows grow up to 20 s.
  - Voice activity is judged on 50 ms frames (any frame above −50 dBFS
    keeps the window), not on the window's mean.
  - Windows never cross a pause or resume event from `timing.jsonl`. Paused
    frames are not in the file, so timestamps are capture-frame based and
    the pause offsets are added back for display.
  - The two tracks are merged by `arrival_ns`.
  - Decimation 48→16 kHz: linear-phase windowed-sinc FIR with its group
    delay compensated, aligned to absolute frame index ≡ 0 (mod 3), using
    the 48 context frames spec 0089 allows on each side. An impulse test
    proves timestamp error below 1 ms.
- **Resources.**
  - `n_threads` is a visible, persisted setting (default 4). On Linux with
    autogroup, `nice` alone does not yield CPU to other apps.
  - A `CancelToken` is installed anyway. When a cancel is pending, the next
    window is shortened.
  - On exit the worker is only asked to cancel and is not joined. Since it
    never touches the Store, an exit counts as a crash for B2 (ADR 0020).
- **Controls.**
  - Ajustes: **Transcrever durante a chamada** (off), the model file (Handy
    path suggested, opened read-only, hash cached by path, size and mtime),
    and the number of threads.
  - The strip offers Pausar transcrição, independent of the capture. It
    applies to the current meeting; the next capture starts unpaused.
- **IPC.** `library_live_transcript(meetingId)` reads a snapshot shared with
  the worker, never files on the actor, and returns segments, state and
  `behindMs`. Updates reuse `capture-changed`, and the UI does not poll at
  capture rate (N4).
- **Default.** Off. Turning it on by default needs B1–B4 tests, a 2-hour
  synthetic two-track run (no gaps, Stop P95 unchanged, ASR duty ≤ 50%, RSS
  measured with Handy loaded, no sustained thermal throttling), WER within 2
  points of offline Tagarela, and Windows validation once capture exists
  there.

### P4 Suggested title from the macserver LLM

Decided 2026-10-31: the user's own endpoint on the macserver. It is an
OpenAI-compatible rapid-mlx server on `127.0.0.1:8000`, reached over SSH.
See [ADR 0024](../architecture/decisions/0024-user-owned-llm-over-ssh-for-titles.md).
P4 needs P3; with P3 off there is no title suggestion.

- **Setting.** Ajustes › Integrações › Título sugerido, off by default and
  separate from P3: local ASR and SSH egress are distinct opt-ins.
- **Knowledge vs Memory** (B5, ADR 0015).
  - The LLM output is a *suggestion* stored in Memory: `outputs/live/title.json`
    with `{title, source: "llm", model, endpoint_host, at, input_tokens}`.
  - It is applied to the session only while the session still has the
    automatic placeholder. The apply is a single
    `UPDATE … WHERE title = ?placeholder` in the actor, so a manual rename
    always wins (N5).
  - The meeting heading shows "título sugerido" with Desfazer, which restores
    the placeholder and dismisses the suggestion.
- **Transport** (should-fix 9).
  - `ssh -W 127.0.0.1:<port>` over stdio: no local port and no listener.
  - Options: `-o BatchMode=yes -o ControlMaster=no -o ControlPath=none -o StrictHostKeyChecking=yes -o ConnectTimeout=5 -o ServerAliveInterval=5 -o ForwardAgent=no -o PermitLocalCommand=no`, and `--` before the target. The target must match `user@host` without a leading dash.
  - One HTTP/1.1 request per process. The child is killed on drop.
- **Input** (should-fix 10, 12, N6).
  - The first title uses the first 5 minutes; the refined one, after the
    drain, uses evenly sampled lines.
  - Both are capped at 1500 tokens, counted conservatively at 3 characters
    per token.
  - The transcript is sent in a delimited block, as data.
- **Output** is sanitized: one line, `<think>` blocks removed, no quotes,
  `[[ ]]`, Markdown, URLs or control characters, at most 80 characters, then
  `NewSession` validation.
- **Failure.** The placeholder stays. No retry loop, and no other host.

## Acceptance

P1:

- [x] Setting off: a detected call never starts a capture. The policy test
  covers it.
- [x] Setting on, idle: the second observation of a call starts one capture
  bound to that episode. No duplicate start comes from later polls or from a
  start still in flight.
- [x] A busy library (capture or processing) never auto-starts.
- [x] The bound episode ends: stop after 20 s. A return or a failed poll
  cancels it. Keep cancels it for that binding.
- [x] A manual stop or switch clears the binding, and nothing else is
  stopped automatically.
- [x] Back-to-back: a new episode during a pending stop stops the old capture
  and starts the new one.
- [x] Strip countdown with Continuar gravando and Parar agora. Settings
  toggles with detection coupling.

P2:

- [x] Overlap rule, nearest start, cancelled and all-day events ignored.
- [x] Planned session reused by title and a start within 30 min. Otherwise a
  session is created with the event's title.
- [x] No event: "Reunião no {app}".

Native acceptance with a real Teams call on Linux and Windows is still
pending (spec 0083).

## Evidence (P1–P2, 2026-10-31)

- Rust:
  - `auto_record::policy::tests` (6): off/on, single start, busy library,
    manual recording, grace and return, failed poll, keep, auto-stop off,
    manual stop or switch, back-to-back;
  - `auto_record::plan::tests` (4): event overlap and ranking, session reuse,
    invitees, time normalization, device choice.
- Vitest `src/features/capture/autoRecord.test.tsx`:
  - countdown, Parar agora and Continuar gravando calling `auto_record_keep`;
  - the ended prompt silenced only when auto-stop owns the call;
  - settings toggles coupled with detection;
  - device choices synced to the backend.
- Browser harness: `state auto=stop|on` fixtures, strip countdown and the
  Ajustes › Gravação rows checked in dark and light.
- Not covered by tests: the executor that drives the real library (start,
  stop, notifications). It reuses `library_start_session` actions and needs
  the native acceptance with a real call.

## Design reviews

- **Claude Opus 5.5 (Claude Work), 330c10a.**
  - Blocking items B1–B5 were accepted and the design revised above (actor
    lifecycle messages, dedupe on read, a single slot, a non-blocking actor,
    title as a Memory suggestion).
  - Should-fix items were folded in: windows with token-time stitching,
    frame-level voice activity, pause boundaries, FIR, `n_threads`, Pausar
    transcrição, `ssh -W`, output sanitizing, 1500-token cap.
  - Privacy decided by the owner on 2026-10-31: sending excerpts of any
    meeting to the owner's own host is acceptable (ADR 0024).
  - Open: the Windows stress test and the 2-hour benchmark.
- **Gemini 4 Argon (via Cursor, approved by the owner), design ae6279c,**
  checked against the code at 3e9a38c:
  - B1 (stitching at pauses and End, seam words, livelock): already in the
    code. Terminal windows commit everything, words belong to the window
    holding their midpoint, and the cursor always advances by at least 1 s.
  - B2 (refined title and Desfazer): already in the code. The refined title
    replaces the last applied suggestion, and a dismissal blocks any later
    one.
  - B3 (Committed before the manifest rename):
    - on Linux a stale read is benign, because the worker reopens the
      manifest on every wake and re-checks every 5 s;
    - on Windows, Rust's `File::open` shares delete, so `MoveFileExW`
      replacing the manifest does not fail while it is open;
    - capture is still Linux-only.
    - Kept as is, recorded here.
  - S1 fixed: silent and zero-word windows append a hidden marker line, and
    `transcript_progress` drives `complete`. "Transcrever o resto" shows
    only when something is left.
  - S2 and S3 were already in the code: voice activity on the uncommitted
    range, an incremental journal offset, and pause offsets in `start_ms`.
  - S4: unclosed `<think>`, char-safe caps, the response limit and the
    timeout were already there. Added `ClearAllForwardings=yes`. The P4
    toggle lives in Ajustes › Integrações, off by default.
  - S5 fixed:
    - an idle loaded model is released before manual Process;
    - Recover is refused while the live slot is busy;
    - "Transcrever o resto" is refused during a capture, so backfill never
      queues ahead of a live call;
    - exit waits the 250 ms grace.
    - `Store::backup` is only reachable from the CLI binary, not the app.
  - Open:
    - N1, model provenance per window (path, hash and runtime version are
      not yet in `transcript.jsonl`);
    - preempting a backfill that is already running when a capture starts;
    - installing the `CancelToken`.

## Evidence (P3–P4 implementation, 2026-10-31)

- Core (`coxinha-core/src/live/`, feature `stt-tagarela`):
  - 17 tests: FIR impulse alignment, frame-level voice activity, window
    planning and stitching (no lost or duplicated words), pause boundaries
    from the journal, dedupe and partial-line recovery, worker lifecycle
    (End{Interrupted,Failed} terminal, FIFO with one model load, idle
    unload, cancel without join);
  - one test on the real recorder with concurrent checkpoints;
  - an ignored test ran the real Tagarela file.
- Desktop: the `library/live.rs` slot. The actor only spawns and messages.
  `Process` is refused while the slot is busy. Committed is sent after each
  checkpoint, End from `finish` with all three outcomes, and exit cancels
  without joining.
- Titles (`src-tauri/src/titles/`):
  - 31 tests: validate, excerpt and 1500-token cap, sanitize, `ssh -W`
    transport through a fake ssh (Content-Length, chunked, HTTP 500, timeout
    kills the child, ssh exit, missing binary);
  - an ignored test against the real macserver returned "Revisão Migração
    CRM para API v2" in 2.19 s;
  - `retitle_if` is a single conditional UPDATE, and its test covers a
    manual rename winning;
  - the watcher stores the suggestion as Memory in
    `outputs/live/title.json`; Desfazer restores the placeholder.
- UI, `src/features/live/live.test.tsx` (6 tests):
  - the live panel with speakers, status and behind;
  - "Transcrever o resto";
  - the old note when empty;
  - the suggested-title label and Desfazer;
  - the Handy path before enabling;
  - the title server test;
  - the strip "Pausar transcrição" without touching capture.
- Totals: Rust 467 passed, Vitest 685 passed, clippy clean with and without
  `stt-tagarela`.
- Not done:
  - native run with a real call;
  - the 2-hour two-track benchmark;
  - WER of windows against offline Tagarela;
  - RSS with Handy loaded;
  - the Windows stress test;
  - the `CancelToken` is not installed (the `Asr` trait has no hook).
