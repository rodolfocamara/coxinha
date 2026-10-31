# Spec 0096: Frontend redesign (Hoje, Reuniões, Workspace, one recorder)

- **Status:** in-progress (R1 implemented, native acceptance pending)
- **Phase:** F2
- **Owner:** Rodolfo
- **Depends on:** spec 0095 (UI primitives), ADR 0022 (orphan capture
  reconciliation), DESIGN.md (`docs/research/ui-audit/DESIGN.md`).
- **Supersedes:** the recording-control placement of specs 0092, 0093 and
  0094 (controls beside each meeting, sidebar pill, end-of-call banner). Their
  behaviour (detection, end prompt, receipt) moves into the single recorder.
- **Prototype (approved 2026-10-31):**
  `docs/research/2026-10-31-frontend-redesign/prototype.html`, video
  `motion-flows.mp4`. Research: `inventory.md`, `recording.md`, `audit.md` in
  the same folder.

## Why

The owner asked for a new layout that covers every current feature with a
simpler, standard experience. The audit found:

1. Recording controls in 6 surfaces and status in 7 more, each with its own
   copy of the state and 4 independent `library_status` pollers.
2. A REC badge that stays lit after a capture ends: it trusts a process-local
   acknowledgement that is never cleared and a persisted `capture_state` that
   is never reconciled after a crash (root cause in `recording.md` §3).
3. Actions rendered as underlined text, features reachable only through the
   palette, and 8 screens with 3 different layout grammars.
4. Notes and activities split across two places, so a note cannot easily
   become an activity.

## Information architecture

Rail (68px, icon above label, always visible): **Hoje**, **Reuniões**,
**Workspace**, **Pessoas**, **Buscar** (palette), then the record button and
**Ajustes** at the bottom. A 38px **recorder strip** sits above everything and
doubles as the window title bar (drag region and window buttons).

| Route | Screen | Replaces |
|---|---|---|
| `/` | Hoje (home) | `/home` (dead), board as start screen |
| `/meetings` | Reuniões: list + detail + inspector; tabs "Próximas e recentes", "A revisar", "Mês" | `/calendar`, `/agenda`, `/meetings` (library), sidebar session list |
| `/meetings/$sessionId` | Same screen with the meeting selected | `/sessions/$sessionId` |
| `/workspace` | Workspace: notes drawer + canvas + side editor | `/` board, `/notes` |
| `/workspace/$noteId` | Workspace with that note open in the side editor | `/notes/$noteId` |
| `/people` | Pessoas: list + detail with voice samples | `/people` |
| `/settings` | Ajustes: section list + content | `/settings` |

Old paths redirect to the new ones so tray, shortcuts and stored links keep
working. The right side panel, chrome tabs and breadcrumb are removed.

## Model decisions

1. **One recorder.** A headless `CaptureController` mounted once in the root
   layout is the only caller of `library_status` and the only place that
   starts, pauses, stops or switches captures. It listens to the
   `capture_changed` event and polls meters at 4 Hz only while live. The
   **RecorderStrip** is the only UI with capture controls; it absorbs call
   detection prompts (detected, call ended, next call) and the start receipt.
   Every other screen reads `useIsLive(sessionId)` and shows a read-only
   `LiveBadge`. A meeting page may offer "Gravar esta reunião", which calls
   the controller; it never shows devices, meters, pause or stop.
2. **REC means live.** Live state comes only from the backend (`live` per
   session, `Worker.active`). `capture_state` drives "Salva / Interrompida /
   Precisa recuperar", never REC. The acknowledgement cache is removed.
3. **A note and an activity are the same object.** An activity is a board
   item of kind `card` (progress, area, dependencies); a note is the same
   Markdown file as a `text` item or not on the board at all. "Virar
   atividade" changes the item kind; the file and its text never change.
   A checklist line can become a new activity linked to its source note.
   Links join two note-backed items when at least one side is an activity
   (`board.rs`); demoting keeps a link while its other side is an activity.
4. **Notes off the board are visible.** The Workspace drawer lists notes no
   board item references (meeting notes, shortcut notes, palette notes) under
   "Fora do quadro", with "Colocar no quadro". Meeting notes stay off the
   board until the user places them.
5. **One editor.** Notes open in the Workspace side editor (360px) next to the
   canvas, with an "open full width" mode. The inline canvas editor and the
   separate note route are removed.
6. **People totals come from the backend.** `library_voice_profiles_page`
   adds `activeSamples` and `sampleMeetings` per person (same "active" rule
   as the sample projection, bounded by the page). This amends the spec 0078
   R2 "loaded samples only" display rule, approved by the user 2026-10-31.

## Visual rules

- Direction D from the prototype: dense list + detail + inspector, light and
  dark themes, tangerine as the only action/data hue, red only for live
  capture, amber for attention, green for done, blue for Outlook.
- A soft ambient gradient behind the app (three blurred radial blobs, low
  alpha, static), switchable off in Ajustes > Geral.
- No action as underlined text. Navigation uses buttons or rail items.
- Speaker lanes ("faixa de falas") are the product signature on meeting
  detail.

## Motion (normative)

Speed first: the new state renders at once; motion only shows where things
went. Only `transform` and `opacity` animate. Nothing waits for an animation
before accepting input.

| Token | Value | Use |
|---|---|---|
| `--m-instant` | 80ms | press and hover |
| `--m-fast` | 140ms | fades, tab and rail indicators |
| `--m-med` | 200ms | panels, sheets, editor, card morphs |
| `--m-zoom` | 380ms | spatial navigation only |
| `--e-out` | `cubic-bezier(.2,.8,.2,1)` | default |
| `--e-spring` | `cubic-bezier(.34,1.5,.5,1)` | pops (live dot, promoted card) |

Required motions: Hoje → Workspace zoom from the preview (shared element per
card, View Transitions API) and its reverse; meeting title morph from Hoje;
sliding rail/tab/segmented indicators; recorder strip sweep and live dot pop;
editor slide-in; note placed from the drawer flies to its spot; checklist line
flies out as a new card and its link draws in; new transcript lines rise.
Without View Transitions support or with `prefers-reduced-motion`, state
changes apply instantly with no error.

## Phases and acceptance

Each phase lands green (vitest, typecheck, cargo tests, clippy) and keeps
every existing behaviour reachable.

### P1 Recorder and live state

1. Backend: boot reconciliation (ADR 0022), `live` per session,
   `capture_changed` event, with Rust tests.
2. `captureStore` + `CaptureController` in the root layout; no other
   component calls `library_status`, `library_start*`, `library_pause` or
   `library_stop`.
3. `RecorderStrip` renders idle, detected call, recording, paused, call
   ended, next call, processing, error and needs-recovery, with tests per
   state. Toggle shortcut (`toggle-recording`) starts or stops through the
   controller.
4. `LiveBadge` everywhere a meeting appears. Tests: interrupted capture with
   a previous start shows no REC; persisted `recording` without a live
   capture shows no REC; a live session shows REC.

### P2 Shell, rail, routes, motion foundation

1. New `AppShell`: strip, labelled rail with sliding indicator, ambient
   gradient, no side panel, tabs or breadcrumb.
2. Routes and redirects from the table above, with router tests.
3. Motion tokens, `viewTransition` helper (feature detected, reduced-motion
   aware) and the shared-element naming convention.

### P3 Hoje

Greeting and a one-line lede with the day's finding; today's agenda (Outlook
+ meetings, live row highlighted); "A revisar" (speaker to confirm, failed or
missing transcription); recent notes; Workspace preview that zooms into the
board; week strip of recorded time.

### P4 Reuniões

List with groups (Agora, Hoje, Próximos dias, Anteriores) merging meeting
sessions and Outlook events; "A revisar" and "Mês" tabs; detail with finding
banner, speaker lanes, tabs Notas / Transcrição (Ao vivo while recording) /
Falantes; inspector with when, event, audio, transcription, participants and
actions (import audio, transcribe again, open folder). "Nova reunião" and
"Importar áudio" open sheets.

### P5 Workspace

Notes drawer (search, "Fora do quadro", "No quadro"), canvas with areas,
activity and note cards, side editor with the Nota/Atividade switch,
progress, area, dependencies and checklist → activity.

### P6 Pessoas, Ajustes, cleanup

Pessoas and Ajustes in the list + detail grammar; palette entries for every
destination; removal of dead routes and components (`/home`, side panel,
chrome tabs, session sidebar, `RecordingStatus`, `CaptureSection` in
library and session, the acknowledgement cache).

## Out of scope

- Windows capture (capture stays Linux-only; the recorder shows the
  unsupported state).
- Removing the stub `recorder.rs` commands (separate cleanup).
- New AI features, sync or network calls.

## Evidence

### R1 (2026-10-31)

- **P1.** Backend: `Store::reconcile_orphan_captures` runs in `Library::open`
  (tests `orphan_with_valid_raw_is_recovered_as_interrupted`,
  `orphan_with_broken_raw_is_released_but_files_are_untouched`,
  `finished_and_new_rows_are_untouched`,
  `reconciliation_unblocks_local_processing_claims`); `live` per session
  (`live_is_set_only_for_the_active_meeting`,
  `sessions_expose_null_live_without_capture`); `capture-changed` event from a
  capture signature watch (`watch_notifies_on_capture_state_changes_only`,
  `status_polling_does_not_notify`). Frontend: `captureStore`,
  `captureActions`, `CaptureController` (only `library_status` reader),
  `RecorderStrip` (states tested in `RecorderStrip.test.tsx`), `LiveBadge`
  (REC criteria in `captureStore.test.tsx`). The acknowledgement cache,
  `RecordingStatus`, `MeetingReminder` and `CaptureSection` are gone; the
  shortcut toggles capture.
- **P2.** `Shell`/`ShellFrame`, `NavRail` with sliding indicator, ambient
  gradient, routes and redirects (`/notes*`, `/sessions/*`, `/home`,
  `/calendar`, `/agenda`), `src/lib/motion.ts` + `src/styles/motion.css`.
  Old chrome (sidebar, chrome cap, tabs, breadcrumb, side panel, dev preview
  routes) removed.
- **P3-P6.** Built in parallel worktrees from one base and integrated:
  `src/features/hoje`, `meetingsHub`, `workspace`, `people`, settings and
  palette. Each area kept its old capabilities; gaps are listed below.
- **Checks.** `vitest run`: 88 files, 674 tests passing (twice green after
  integration). `tsc --noEmit` clean. `cargo fmt --check`, `cargo clippy
  --workspace --all-targets -D warnings`, `cargo test` for `coxinha-core` and
  `coxinha` (262) green.
- **Visual.** `tools/ui-preview/shoot.mjs` mocks the Tauri IPC in Chromium.
  Screens checked in dark and light; the Hoje → Workspace zoom verified
  frame by frame (cards fly from the preview to the canvas) and a real-speed
  video of the integrated flow.

### Remaining

- No IPC for: opening the recording folder, importing audio into an existing
  meeting, searching transcript text, the user's display name.
- "Falante a confirmar" appears in meeting detail, not in lists or Hoje
  (one recognition read per meeting).
- Native acceptance in the Tauri window on Linux and Windows.
