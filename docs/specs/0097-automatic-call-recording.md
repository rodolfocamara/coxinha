# 0097 — Automatic call recording, live transcript and meeting titles

Status: in-progress (P1–P2 implemented; P3–P4 designed, implementation under review gate)
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
- Cloud ASR or LLM. Every model runs on this computer (ADR 0021 item 8).
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
runtime, pinned to `transcribe-cpp = "=0.2.4"`, the schema the file was
converted to.

Spike on this host (CPU only, synthetic pt-BR TTS clip):

- load in 0.56 s;
- 14.7 s of audio transcribed in 1.5 s, about 10x real time;
- one error ("rouback").

The model reports `supports_streaming: false`, so P3 uses bounded windows
(spec 0089), not native streaming.

- **Model file.** Configured in Ajustes › Transcrição local with the Handy
  path as the suggestion. It is opened read-only and never copied, renamed or
  converted. Its SHA-256, size and runtime version are recorded with every
  output. If it fails to load, live transcription stops before the first
  window and the recording itself is unaffected.
- **Setting.** **Transcrever durante a chamada**, persisted next to the
  model path.
- **Worker.** One worker thread per capture:
  - started by the library worker after a capture starts, never by the UI;
  - holds its own `Model` and `Session`, loaded at start and dropped after
    the drain;
  - runs at lower priority (Linux `nice` 10) with a bounded number of
    inference threads;
  - never holds the recorder or library locks, and reads PCM only through
    `CommittedTrack` snapshots on independent descriptors.
- **Windows.** Each track has its own cursor on the 48 kHz capture clock.
  - A window is dispatched when at least 8 s of new committed audio exist.
  - It ends at the quietest 100 ms inside its last 2 s, and is forced at
    20 s.
  - Silent windows (RMS below −50 dBFS) are skipped and only advance the
    cursor.
  - Decimation 48→16 kHz uses a fixed windowed-sinc FIR.
- **Output.** Appended to `raw/<meeting>/live/transcript.jsonl`, one segment
  per line: `{track, start_ms, end_ms, text}` on the capture clock. After
  each window, `live/cursor.json` is replaced atomically, so a crash resumes
  without duplicating or losing text.
  - Segments are provisional. They are never used as confirmed speaker
    identity or task evidence.
  - The manual post-call pipeline (Whisper and diarization) is unchanged and
    still optional.
- **Stop.** The worker drains what is left of the committed audio (manifest
  `finished`) and then exits. A cancel request is checked between windows. A
  run already in progress finishes, because transcribe.cpp holds one
  in-flight call per model.
- **Priority.** Capture, autosave and Stop never wait for inference. If the
  worker falls behind, it skips nothing; it reports its backlog
  (`behindMs`). It never drops audio.
- **IPC.** `library_live_transcript(meetingId)` returns segments, state
  (`idle | running | draining | done | failed`) and `behindMs`. Changes
  reuse `capture-changed`. The meeting page shows the live text with
  "provisório" while recording.
- **Gate.** Spec 0089 requires independent design reviews (Claude Opus 5.5
  Work, Gemini 4 Argon) before inference runs during capture. The setting
  ships off and is not enabled by default until both reviews are addressed.

### P4 Automatic title from the macserver LLM

Decided 2026-10-31: the user's own Qwen endpoint on the macserver. It is an
OpenAI-compatible rapid-mlx server on `127.0.0.1:8000`, reached through SSH
(`macserver@192.168.15.66`). See
[ADR 0024](../architecture/decisions/0024-user-owned-llm-over-ssh-for-titles.md).

Measured: a 112-token prompt took 1.4 s end to end through a tunnel. The
server limits prompts to 8192 tokens. It currently serves
`gemma-4-e4b-4bit` under the name `qwen3.5-4b`.

- **Settings** (Ajustes › Integrações, off by default): SSH target, remote
  port, model name. The tunnel is
  `ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -L 127.0.0.1:<free>:127.0.0.1:<port>`.
  It opens on demand, is closed after each request, and uses the system's
  SSH keys. Coxinha stores no secret.
- **Which sessions.** Only sessions the auto-record executor created without
  a calendar event. Their placeholder title is remembered in
  `live/title.json`. A title is replaced only while the session title still
  equals the last automatic one, so a manual rename always wins.
- **First title.** When the live transcript covers 5 minutes of audio, the
  first 5 minutes of text from both tracks go to the LLM. The prompt asks for
  a pt-BR title of at most 8 words, without quotes.
- **Final title.** After the drain at Stop, the whole transcript is used,
  capped at about 6000 tokens (head plus evenly sampled lines).
- **Failure.** The placeholder stays and a warning is logged. No retry loop.

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
