# 0097 — Automatic call recording, live transcript and meeting titles

Status: in-progress (P1–P2 implemented; P3–P4 waiting on engine decisions)
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

### P3 Live transcript (waiting on decisions)

Windowed local ASR over committed checkpoint ranges (`CommittedTrack`, spec
0089) while recording, with provisional segments stored next to the capture
and shown in the meeting page. Open items:

- which engine and model to use (Whisper ggml, which exists today, or
  Tagarela GGUF, which needs a new runtime);
- the spec 0089 gate of independent design reviews before capture and
  inference run concurrently.

### P4 Automatic title (waiting on decisions)

- After about 5 minutes of live transcript, ask a local LLM for a short pt-BR
  title. Refine it from the full transcript after Stop.
- Applies only when P2 found no event and the user has not renamed the
  session.
- Open item: the local LLM runtime. Ollama is not installed on this machine;
  a GGUF such as Qwen3.5-4B could run embedded instead.

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
