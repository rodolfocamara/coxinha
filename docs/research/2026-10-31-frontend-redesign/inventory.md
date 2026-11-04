# Coxinha frontend: functional inventory (redesign brief)

Source: the repository root, branch `feat/0058-meeting-library` (HEAD `94a2aeb`). The code is the source of truth; specs 0058 to 0095 were used only for context. Paths are relative to the repo root unless noted (`src/...`, `src-tauri/...`). Test files were ignored. Labels quoted from `src/locales/en.json`.

## 0. Summary

| Item | Count | Notes |
|---|---|---|
| Registered routes | 11 prod + 2 dev | `/`, `/notes`, `/notes/$noteId`, `/home`, `/sessions/$sessionId`, `/agenda`, `/calendar`, `/meetings`, `/people`, `/settings` (prod, `src/router.tsx`). `/` and `/notes` render the same screen. `/home` is unreachable. DEV only: `/dev/menu-preview`, `/dev/shell-preview` |
| Distinct reachable screens | 8 | Activity board, Note detail, Session workspace, Agenda, Calendar, Meeting library, People & voices, Settings |
| Global surfaces | 10 | Sidebar (rail + sessions list), chrome cap, recording status (sidebar card / top bar), meeting reminder banners, command palette, startup alert, save-failed toast, exit-saving overlay, exit recovery dialog, root error page |
| User actions catalogued | ~200 | ~25 global/shell + ~75 notes/board/agenda/detection + ~95 meetings/sessions/people/calendar + settings |
| Backend IPC commands registered | 70 | `src-tauri/src/lib.rs:189-259` |
| IPC commands called by the UI | 57 | 13 have no UI caller (section 5). Only 22 are typed in `src/lib/bindings.ts`; the other 48 are raw `invoke()` strings (bindings are stale) |
| IPC events | 7 | Listened: `navigate`, `desktop-flush`, `desktop-recovery`, `desktop-exit-aborted`. Emitted but never listened to: `call-detected`, `recording-progress`, `transcription-progress` |
| Domain objects | 11 | note, board item (card/text/area) + dependency edge, meeting session, recording (capture), processing job/transcript, speaker assignment, person, voice sample/profile, participant candidate, calendar event (Outlook), detected call |
| Polling loops | 7 | `library_status` x4 (LibraryView 250 ms, SessionRecording 1 s, RecordingStatus 0.5/2 s, CallDetectionController 3 s), `call_detection_status` 3 s, `library_sessions` 3 s, `library_session` 3 s |

### Route map (what reaches what)

| Route | Screen | Reached from |
|---|---|---|
| `/` | Activity board (`src/routes/NotesIndexRoute.tsx` → `src/features/board/ActivityBoard.tsx`) | Rail "Activities", brand logo ("Activity map"), app start, global shortcut `open_app` (IPC `navigate:home`). Tray "Open" only shows the window |
| `/notes` | Same Activity board | Note delete redirect, `AppError` "Board" link, `NoteDetailError` "Open notes" |
| `/notes/$noteId` | Note detail (`src/routes/NoteDetailRoute.tsx` → `src/features/notes/NoteEditor.tsx`) | Palette note rows, palette "New note", tray "New note", global shortcut `new_note`, backlinks list, Duplicate, (unreachable) Home recents. NOT reachable from a board card |
| `/sessions/$sessionId` | Session workspace (`src/routes/SessionRoute.tsx`) | Sidebar session rows, sidebar "+" create, Calendar entries, RecordingStatus title/"Open meeting", MeetingReminder receipt "Open meeting" |
| `/agenda` | Outlook agenda (`src/routes/AgendaRoute.tsx`) | Palette "Open agenda", Calendar header "Outlook agenda", SessionHeading "Open agenda", Settings Integrations "Open agenda", global shortcut `agenda`. Not in the rail |
| `/calendar` | Sessions calendar (`src/routes/CalendarRoute.tsx`) | Rail "Calendar" |
| `/meetings` | Meeting library (`src/routes/MeetingsRoute.tsx` → `src/features/meetings/LibraryView.tsx`) | Rail "Recordings", RecordingStatus "Open meeting library", SessionRecording "Open capture and import", global shortcuts `meetings` and `toggle_recording`, `AppError`, `NoteDetailError` |
| `/people` | People & voices (`src/routes/PeopleRoute.tsx` → `src/features/meetings/PeopleDirectory.tsx`) | Rail "People & voices" |
| `/settings` | Settings (`src/routes/SettingsRoute.tsx` → `src/features/settings/SettingsView.tsx`), supports `#hash` deep link to a section | Rail "Settings", palette "Open settings", tray "Settings", Agenda "Configure" (`#integrations-heading`), note recovery links (`#rebuild-heading`), `AppError` |
| `/home` | Home (`src/routes/HomeRoute.tsx`) | Nothing. Dead |
| `/dev/menu-preview`, `/dev/shell-preview` | Dev previews (`src/routes/DevMenuPreviewRoute.tsx`, `DevShellPreviewRoute.tsx`) | Only by programmatic navigation in DEV (`window.__coxinha.router`, `src/App.tsx`) |

---

## 1. Global shell

Every route wraps itself in `AppShell` (`src/components/AppShell/AppShell.tsx`). `RootLayout` (`src/routes/__root.tsx`) owns global listeners, the palette and detection polling. `DesktopLifecycle` (`src/lib/DesktopLifecycle.tsx`) is mounted in `src/App.tsx` outside the router.

### 1.1 Layout anatomy

| Region | Contents | File |
|---|---|---|
| Skip link | "Skip to canvas" (focus-visible only) → `#canvas` | `AppShell.tsx` |
| Left sidebar (`#workspace-sidebar`, collapsible, persisted `localStorage coxinha:workspace-sidebar`) | Brand button (logo + "Coxinha", goes to `/` via window event `coxinha:open-map`), drag region, collapse toggle, RecordingStatus card (`variant="sidebar"`), Rail | `AppShell.tsx`, `SidebarToggle.tsx`, `src/lib/sidebar.ts` |
| Chrome cap (top bar of content column) | When sidebar collapsed: expand toggle + logo button. Tabs (only rendered if >1 tab; no route passes >1, so tabs never render) or breadcrumb (trail, or the single tab label). Drag region (double click = maximize). Optional right slot. Side-panel toggle (only if route has a side panel). Native window buttons minimize / maximize-restore / close (Tauri only), plus inline "Window action failed. Try again." + Retry | `ChromeCap.tsx`, `ChromeTabs.tsx`, `Breadcrumb.tsx`, `WindowChrome.tsx`, `useWindowChrome.ts` |
| Recording top bar | RecordingStatus `variant="bar"`, only when the sidebar is collapsed | `AppShell.tsx`, `RecordingStatus.tsx` |
| Meeting reminder banner | Detection banners (1.6) on every route | `src/features/detection/MeetingReminder.tsx` |
| Main canvas (`#canvas`) | Route content | |
| Right side panel (`#side-panel`, persisted `coxinha:side-panel`, toggled by chrome button or Ctrl+\\) | Only Agenda (`AgendaPanel`, static help) and unreachable Home (`HomePanel`, empty) pass one | `SidePanel.tsx`, `src/lib/panels.ts` |
| Window frame | Rounded window clip, 10 px resize gutters with 8 resize directions (disabled when maximized/fullscreen) | `WindowFrame.tsx` |

Unused shell pieces: `RailSection.tsx` (exported, never used by Rail), `SavedIndicator.tsx` (only dev routes), `chromeLeft`/`chromeRight` slots (only dev routes), `ChromeTabs` close/new-tab affordances (no caller supplies handlers), `Rail` `onOpenPalette` prop (unused).

### 1.2 Rail (sidebar navigation), `src/components/AppShell/Rail.tsx`

| Order | Item | Label (en / pt-BR) | Target |
|---|---|---|---|
| 1 | Search (shows `Ctrl K` / `⌘ K`) | Search / Buscar | Opens command palette (window event `coxinha:open-palette`) |
| 2 | LayoutDashboard | Activities / Atividades | `/` (exact match) |
| 3 | CalendarDays | Calendar / Calendário | `/calendar` |
| 4 | Mic | Recordings / Gravações | `/meetings` (page title there is "Meeting library") |
| 5 | Users | People & voices / Pessoas e vozes | `/people` |
| 6 | Sessions section | see 1.3 | |
| bottom | Settings | Settings / Configurações | `/settings` |

Not in the rail: Agenda, Notes list (none exists), Home.

### 1.3 Sidebar sessions list, `src/features/sessions/SessionSidebar.tsx` (+ `SessionList.tsx`, `SidebarPeriodFilter.tsx`, `PeriodSelector.tsx`, `sidebarPreferences.ts`)

- Header "Sessions" with period filter popover (All / Today / This week / This month / Last 30 days / Custom range with From/Through, Apply/Cancel; dot when active; Esc/outside click closes) and "+" "New meeting".
- "+" opens an inline form (title, max 500) → "Create" → `library_create_session` (status planned) → navigates to `/sessions/$id`. This is the only manual session creation in the app.
- Day groups (collapsible, persisted `localStorage coxinha:session-sidebar`), each row: REC pulse, title, time ("recorded" prefix when the date comes from the recording), icons audio / transcript / status / processing / note error, "failed" tag; `aria-current` when open.
- States: desktop required (browser), loading, error + Retry, empty, all filtered out + "Reset".
- IPC: `library_sessions` (polled every 3 s via shared `sessionListCache`, invalidated by window event `coxinha:sessions-changed`), `library_create_session`.

### 1.4 Recording status, `src/components/AppShell/RecordingStatus.tsx`

Never starts a recording. Polls `library_status` (500 ms while active/processing, 2 s otherwise). Hidden when idle and no error.

| Variant | Where | Shows | Actions (IPC) |
|---|---|---|---|
| Sidebar card | Under brand row when sidebar open | Pulsing dot (red, amber when paused), "Recording {mm:ss}" / "Paused {mm:ss}", 3-bar level meter (mic/output peaks), session title (link to `/sessions/$id` when matched), processing phase line ("Validating" / "Inference" / "Stopping" / "Processing" + "continues in background"), error "failed", detection receipt + metadata-failed alert | Pause/Resume (`library_pause`), Stop (`library_stop`), "Dismiss notice" (receipt), links "Open meeting library" (`/meetings`) and "Open meeting" (`/sessions/$id`) |
| Top bar | Under chrome cap when sidebar collapsed | Same data in one row (no level meter) | Same |

Session matching uses `sessionListCache`, `sessionCaptureCache` and the detection receipt (`useDirectCapture`). It sets `useRecordingStatusHost.activeMounted` so the MeetingReminder receipt banner is suppressed while the card is visible.

### 1.5 Command palette (Ctrl+K / Ctrl+P), `src/features/shell/CommandPalette.tsx`

Modal (`role=dialog`), input "Search notes, run a command…". Filters note titles client side (substring, max 20); no full-text search (IPC `search_notes` is unused). Empty query lists all notes then actions.

| Row | Label | Hint shown | Effect | Hint actually bound? |
|---|---|---|---|---|
| Note rows | note title or "Untitled" | trash icon on hover | Open `/notes/$id`; trash = confirm + `delete_note` | Ctrl+Backspace on focused row = delete (bound inside palette) |
| Action | New note | `Ctrl+N` | `create_note` → `/notes/$id` (orphan note, not placed on board) | No. In-app Ctrl+N is not bound; global is Ctrl+Alt+Y |
| Action (only on `/notes/$id`) | Delete this note | `Ctrl+Backspace` | confirm + `delete_note` → `/notes` | Only inside the palette |
| Action | Open agenda | `Win+Shift+A` | `/agenda` | No. Global default is Ctrl+Alt+G |
| Action | Toggle theme | | light/dark flip (writes theme pref) | |
| Action | Open settings | `Ctrl+,` | `/settings` | No |

Keys: ↑/↓, Enter, Esc, Ctrl+Backspace. Footer hints show `⌘⌫` on all OSes. Missing commands: no navigation to Calendar, Recordings, People, Sessions; no start/stop recording; no new session. The palette's 16 strings are missing from `pt-BR.json` (English in pt-BR).

### 1.6 Keyboard shortcuts

| Scope | Shortcut | Effect | File |
|---|---|---|---|
| Global (OS), default | Ctrl+Alt+Y | Show window + new note → `/notes/$id` | `shared/src/lib.rs:209`, `src-tauri/src/shortcuts.rs` |
| Global | Ctrl+Alt+O | Show window → `/` | same |
| Global | Ctrl+Alt+G | Show window → `/agenda` | same |
| Global | Ctrl+Alt+T | Show window → `/meetings` | same |
| Global | Ctrl+Alt+W ("toggle recording") | Show window → `/meetings` only; does NOT toggle recording | `src/routes/__root.tsx` `handleRoute` |
| App | Ctrl/Cmd+K, Ctrl/Cmd+P | Toggle command palette | `src/routes/__root.tsx` |
| App | Ctrl/Cmd+\\ | Toggle right side panel (only visible effect on Agenda) | `src/routes/__root.tsx` |
| Note | Ctrl/Cmd+. | Toggle note actions menu | `src/features/notes/NoteEditor.tsx:285` |
| Note menu | shows Ctrl+L (copy link), Ctrl+D (duplicate), Ctrl+Z | Only Ctrl+Z works (BlockNote) | `NoteActionsMenu.tsx` |
| Palette | ↑ ↓ Enter Esc Ctrl+Backspace | navigate / open / close / delete note | `CommandPalette.tsx` |
| Board | Delete (edge selected) | Remove dependency. Node Delete disabled | `ActivityBoard.tsx` |
| Board card | Enter / double click | Edit card; Esc finishes | `CanvasNote.tsx`, `CanvasTextEditor.tsx` |
| Session tabs | ← → Home End | Move between tabs | `SessionRoute.tsx:89` |
| Session title edit | Esc | Cancel rename | `SessionHeading.tsx` |
| Recovery dialog | Esc (= Keep open), Tab trap | | `DesktopRecoveryDialog.tsx` |
| Settings | Rebind UI | None: read-only list, "Editing … will be available in a later version" | `SettingsSections.tsx` |

### 1.7 Tray menu, `src-tauri/src/tray.rs` (labels `src-tauri/locales/en.yml`)

| Item | Label | Effect |
|---|---|---|
| Left click on icon | | Show main window |
| open | Open Coxinha | Show main window |
| new-note | New note (Ctrl+Alt+N) | Show window + `navigate:notes-new`. Label shows Ctrl+Alt+N but the default shortcut is Ctrl+Alt+Y |
| separator | | |
| settings | Settings | Show window + `navigate:settings` |
| quit | Quit | `desktop::request_exit` (flush protocol, 1.8) |

No recording items (start/stop/pause), no recording state in the tray.

### 1.8 Global dialogs, banners and toasts

| Surface | Trigger | Content / actions | File |
|---|---|---|---|
| Startup alert (top strip) | `list_notes` or `navigate` listener failed at boot | "Notes or desktop shortcuts could not load. Retry to reconnect." + Retry | `src/routes/__root.tsx` |
| Window close = app exit | Close button / Alt+F4 → `CloseRequested` is intercepted → `request_exit` | No confirmation; flushes saves, finalizes recording, exits. Note: contradicts the "tray-resident, closing hides" invariant in `CLAUDE.md` | `src-tauri/src/lib.rs:148`, `src-tauri/src/desktop.rs:172` |
| Exit saving overlay | `desktop-flush` event, shown after 750 ms | Full-screen "Saving…" status, app inert | `src/lib/DesktopLifecycle.tsx` |
| Exit recovery dialog | `desktop-recovery` event (reasons `save_failed`, `attachment_pending`, `flush_delayed`, `shutdown_failed`) | Title "Coxinha needs attention", reason text, discard warning; buttons "Keep open" (`cancel`), "Retry", "Discard and exit". IPC `desktop_recovery_response`, `desktop_flush_started`, `desktop_flush_result` | `src/lib/DesktopRecoveryDialog.tsx` |
| Save-failed toast (bottom left) | window event `coxinha-save-error` (any editor save failure) | "Changes could not be saved. Keep Coxinha open and retry." + Retry (`flushPendingSaves`); reports `desktop_diagnostic` | `DesktopLifecycle.tsx` |
| Root error page | Any uncaught route render error | "Coxinha needs attention", diagnostics text (`desktop_diagnostic_info`), Retry, links Board / Meetings / Settings | `src/lib/AppError.tsx` |
| Note route error | Note load failed | "Note unavailable" + guidance, links meeting library / notes / rebuild settings, Try again | `src/routes/NoteDetailRoute.tsx` |
| Meeting reminder banners | Detection (priority order): next call during recording, call ended during recording, recording receipt, possible meeting | See Part C 1.6 (§2.A below). Buttons: "Yes, record", "Ignore this call", "Meeting details" (Outlook invitation picker + title), "Stop and save now", "Keep recording", "Start new meeting", "Same meeting", "Open meeting", "Dismiss notice" | `src/features/detection/MeetingReminder.tsx`, `MeetingDetails.tsx`, `directCapture.ts` |
| Meeting end prompt | Same as "call ended" banner above (spec 0094); no separate modal | | `MeetingReminder.tsx` |
| Window focus side effect | Call ends or second call while recording → main window unminimized and focused | | `src/features/detection/meetingDetection.ts` |
| Diagnostics reporting (invisible) | window `error`/`unhandledrejection` → `desktop_diagnostic` | | `DesktopLifecycle.tsx`, `src/lib/lifecycle.ts` |

There is no toast system: feedback is inline `Alert`s per screen, `window.confirm()` for destructive note actions, and the components above.

### 1.9 Cross-cutting client state (persisted preferences outside Settings)

| Key | What | Set from |
|---|---|---|
| `coxinha.themePref` | auto/light/dark | Settings Appearance, palette "Toggle theme" (`src/lib/theme.ts`) |
| `coxinha:workspace-sidebar` | sidebar open | sidebar toggle |
| `coxinha:side-panel` | right panel open | chrome toggle, Ctrl+\\ |
| `coxinha:session-sidebar` | collapsed day groups | sidebar session list |
| `coxinha:meeting-detection` | detection on/off (default on) | Settings > Meeting detection |
| `coxinha:note-font`, `coxinha:note-small`, `coxinha:note-full-width` | note typography (global, not per note) | Note actions menu |
| `outlook.clientId`, `outlook.tenant` | Outlook app registration | Outlook card "Advanced" (Agenda or Settings) |
| Language | Follows `navigator.language` (en / pt-BR), no UI to change it; backend `AppConfig.locale` ignored by UI | `src/lib/i18n.ts` |

---

## 2. Screens (per route)

Detailed per-screen tables come from two scoped passes, merged below without loss. §2.A covers board, notes, home, agenda and detection; §2.B covers meetings, sessions, people and calendar. Settings is in section 4.

### 2.A Notes, board, home, agenda, detection (Part C)

Scope: `src/features/{notes,board,home,agenda,detection}`, routes `NotesIndexRoute`, `NoteDetailRoute`, `HomeRoute`, `AgendaRoute`, libs `store.ts`, `noteSessions.ts`, `saveQueue.ts`, `noteFileErrors.ts` (+ `notePersistence.ts`). All paths relative to `src/`.

Key facts up front:
- `/` and `/notes` both render the Activity Board (`routes/NotesIndexRoute.tsx`). There is no notes list screen; the board is the notes index.
- Notes have two different editors: BlockNote (`features/notes/NoteEditor.tsx`) and a TipTap "canvas" editor (`features/board/editor/*`). Which one opens depends on where you are and on whether the Markdown has `<span style="color: #xxxxxx">` (then even `/notes/$id` uses the canvas editor via `ColoredNoteEditor`).
- Home (`/home`) is reachable by no link, palette entry or IPC route; it renders mostly empty data (fixtures hook stripped to empty arrays plus recents from real notes).
- Agenda data is real IPC (Outlook via `calendar_*`). `features/agenda/fixtures.ts` is dead.
- Detection banners are mounted inside every `AppShell` (`components/AppShell/AppShell.tsx:114`); the polling controller is mounted once in `routes/__root.tsx`.
- Board strings live in `features/board/locale.ts` (own en/pt bundles injected into i18n, namespace `board`), not in `locales/*.json`.

---

#### 1. Screens and panels

##### 1.1 Activity Board: routes `/` and `/notes`
File: `routes/NotesIndexRoute.tsx` -> `features/board/ActivityBoard.tsx`. AppShell tab "Activity board". No side panel, no trail.
Purpose: freeform canvas (React Flow / `@xyflow/react`) of activity cards (each backed by a Markdown note), free-text cards (also notes), colored areas (groups with aggregated progress), and directed dependency edges. Canonical data in `<vault>/.coxinha/board.json`.

IPC: `board_load`, `board_save` (debounced 600 ms after any change, on unmount, and as desktop exit save participant), `board_export_recovery`, plus `create_note` (via store `newNote`), `get_note`, `update_note` (card editors), `list_notes` (store, loaded at root).

States:
| State | UI |
|---|---|
| Loading | "Loading" status text |
| Load error | Alert + "Retry load" button (re-invokes `board_load`) |
| Empty (no items) | Empty state: icon, "Make room for your ideas", body, button "Create your first activity" |
| Dirty | Toolbar status spinner "Unsaved changes" + "Save" button |
| Saved | Check icon "Board saved" |
| Save error | Alert with category text (`saveError` / `conflictError` / `validationError`), buttons "Save recovery copy in vault" (`board_export_recovery`), "Reload saved board" (opens confirm) ; toolbar button becomes "Retry" |
| Reload confirm | Inline alertdialog: "Discard" (re-`board_load`, drops local edits) / "Cancel" |
| Recovery saved | Status "recovery saved" |
| Action error | Generic `actionError` alert (export/reload failed) |
| Card creating / create failed | Pending card node "Creating…" or alert + "Retry" / "Cancel" |
| Card note missing | Card shows "Note unavailable" |
| Editing a card | Card expands inline into TipTap editor (class `board-editing`), viewport centers on it, inspector hidden |

User actions (canvas):
| Control / gesture | Effect | IPC |
|---|---|---|
| Toolbar "New activity" (primary) | Create blank note, add card at viewport center, open inline editor focused | `create_note`, then `board_save` |
| Toolbar "Free text" | Same, kind `text` (no progress, no handles) | `create_note`, `board_save` |
| Double-click empty canvas | Create free-text card at pointer | `create_note`, `board_save` |
| Toolbar "Add area" | Add 580x350 blue area named "Area", select it and open inspector | `board_save` |
| Toolbar "Add existing note" (details popover: select + button) | Add card referencing an existing note, open editor | `board_save` |
| Toolbar save state / "Save" / "Retry" | Force flush | `board_save` |
| Toolbar "Outline" (ListTree) | Open inspector in outline mode | none |
| Toolbar inspector toggle (PanelRight) | Show/hide inspector | none |
| Click node | Select; clicking an area also opens inspector | none |
| Double-click card / pencil button / Enter on focused card | Open inline editor for that card | `get_note` |
| Drag card | Move; hovering over an area shows "Release to add to {area}"; drop assigns parent area (area auto-grows to fit children) | `board_save` |
| Drag area | Moves area AND its children (`hierarchy.patchItem`) | `board_save` |
| Resize handles (selected card/text/area) | Resize; card min height = measured content; area cannot shrink below children | `board_save` |
| Drag from right handle to left handle of another card | Create dependency edge (cards only, no self/duplicate; cycles allowed) | `board_save` |
| Select edge + Delete (React Flow `onEdgesDelete`) | Remove dependency (node Delete key disabled: `deleteKeyCode={null}`) | `board_save` |
| Card footer: progress number (when editing) 0-100 step 5 | Set activity progress; progress bar + color (grey/orange/blue/green) | `board_save` |
| Card/area action buttons (when selected): "Bring to front" / "Send to back" | Reorder layer within kind | `board_save` |
| Controls: zoom in/out, fit view, toggle interactive; MiniMap pan/zoom | Viewport (zoom 0.1-2) | none |
| Checklist checkbox in read-only card | Toggle task item, saves note | `update_note` |

Inspector `features/board/BoardInspector.tsx` (aside, close X returns focus to toggle):
| Control | Effect |
|---|---|
| Outline list (details) | Button per item; click selects, centers viewport, opens details |
| "Containing area" select (cards/text) | Assign/unassign parent area |
| `BoardFields` (see below) | Edit selected item |
| Dependencies (details): Source select, Target select, "Add dependency" | Create edge |
| Dependency list "×" ("Remove dependency") | Delete edge |

Fields `features/board/BoardFields.tsx`:
| Item kind | Controls |
|---|---|
| area | Label input (max 1000, limit warning), Color select (neutral/orange/green/blue/purple) |
| card | "Open" button (opens inline editor), Progress number 0-100 |
| text | "Open" button |
| all | "Bring to front", "Send to back", details "Position and size" (x, y, width>=100, height>=60 with range validation), "Remove from board" (removes item + its edges, children lose parent; note file is NOT deleted, no confirm) |

Nodes `features/board/BoardNodes.tsx` (+ `boardNodes.ts` mapping, `BoardCardResizer.tsx`):
- `CardNode` (kinds `card`, `text`): pending/failed states, embedded `CanvasNote`, footer progress (activity only), pencil/front/back buttons when selected, progress track, source/target handles (activity only).
- `AreaNode`: resizer, heading label + "N% · Completed/Not started/In progress · count" or "No activities", front/back buttons, area meter, drop hint.

Inline card editor `features/board/editor/CanvasNote.tsx`, `CanvasTextEditor.tsx`, `CanvasTextView.tsx`, `markdown.ts`, `extensions.ts`:
- Read mode: rendered rich text (bold/italic/strike/code/colored text, headings as h3, lists, task lists with live checkboxes, blockquote, code, hr, preserved raw Markdown blocks). Double-click or Enter -> edit.
- Edit mode toolbar: Bold, Bullets, Checklist, color swatches (5 colors, only with a selection), "Default color", "Finish editing" (✓). Esc finishes. Debounced save 400 ms through shared note save queue.
- States: loading ("Loading"), load error + "Retry load", save failed "Could not save. Your text is retained." + "Retry", recovery (`NoteRecovery`), exit-locked (read-only while app is exiting).
- Activity cards force a leading `#` heading (title) in Markdown; free text does not.
- IPC: `get_note` (typed `commands.getNote`), `update_note` (via store `saveNote`).

##### 1.2 Note detail: route `/notes/$noteId`
File: `routes/NoteDetailRoute.tsx` -> `features/notes/NoteEditor.tsx` (standalone variant). Loader waits for pending writes then `get_note`. AppShell trail `notes / {title}.md`, tab `{title}.md`.

Rendering decision (`NoteEditor`):
1. Recovery pending -> `NoteRecovery`.
2. Not resolved -> `NoteLoadingSkeleton`.
3. Markdown has canvas color spans -> `ColoredNoteEditor` (TipTap canvas editor, no header, no menu, no backlinks).
4. Else BlockNote editor inside `NoteEditorFrame`.

`NoteEditorFrame` (`features/notes/NoteEditorFrame.tsx`) layout: editor column (max 960 px or full width) + right `BacklinksPanel` (standalone only). Contains "More actions" trigger (`MoreHorizontal`, shows `⌘.`/`Ctrl+.`), alert lines for delete/duplicate failures, `NoteHeader`, editor, `NoteActionsMenu`.

`NoteHeader` (`features/notes/NoteHeader.tsx`): read-only title (or "(untitled)"), date meta (updated_at), tag chips `#tag`. Title is derived from the first `#` heading by the backend; tags derive from Markdown. Neither is directly editable here.

Editor (BlockNote + shadcn theme, custom `meeting` block spec from `features/meetings/MeetingBlock.tsx`):
| Action | Effect | IPC |
|---|---|---|
| Type | Debounced save 500 ms via per-note `SaveQueue`; unmount flushes | `update_note` |
| BlockNote default slash menu `/`, side menu drag handles, formatting toolbar | Standard BlockNote blocks (headings, lists, checklist, quote, code, table, image, file, etc.). The custom `meeting` block is in the schema but has no slash item (`features/meetings/slashCommand.ts` is not imported anywhere) | none |
| Paste / drop / upload image or file | Images compressed to WebP (max 1600 px, q .85) then saved; inserted as `coxinha://attachments/...` | `save_attachment` |
| Click dead padding | Moves caret to end of document | none |
| `Ctrl/Cmd+.` | Toggle actions menu | none |
| Retry on recovery | Re-run persistence wait | none |
- Editor is read-only while the desktop exit lock is held.
- Font, small text, full width preferences persist in localStorage (`coxinha:note-font`, `coxinha:note-small`, `coxinha:note-full-width`), global across notes.

`NoteActionsMenu` (`features/notes/NoteActionsMenu.tsx`), popover anchored to trigger, filter box "Search actions…", Esc / outside click closes:
| Item | Effect | Shown when | IPC |
|---|---|---|---|
| Font picker: Default / Serif / Mono ("Ag") | Changes note font class | query empty | none |
| Copy link (hint `Ctrl+L`, not bound) | Clipboard `coxinha://notes/{id}` (nothing handles this URL scheme for notes in scope) | always | none |
| Copy page contents | Clipboard Markdown | always | none |
| Duplicate (hint `Ctrl+D`, not bound) | Creates copy with " (copy)" on first heading, navigates to it | standalone only | `get_note`, `create_note`, `update_note` |
| Move to Trash | `window.confirm` (palette string) then delete, navigate `/notes`. Backend does `fs::remove_file` (permanent, no trash) | standalone only | `delete_note` |
| Small text (toggle) | Font size class | always | none |
| Full width (toggle) | Removes 960 px cap | always | none |
| Undo (hint `Ctrl+Z`) | BlockNote undo | always | none |
| Footer | Word count (computed from initial Markdown, not live) | query empty | none |
- Locale has unused keys for Move to, Archive, Present, Available offline, Customize page, Lock page, Use with AI, Suggest edits, Translate, Import, Export, Version history, "Link copied", "Contents copied" (no copy feedback is shown).

`BacklinksPanel` (`features/notes/BacklinksPanel.tsx`): "Linked from" list; states loading / error "Could not load backlinks. Reopen the note to retry." / empty "No backlinks yet." / list of buttons -> `/notes/$id`. IPC `get_backlinks` (typed `commands.getBacklinks`). No refresh after editing.

`NoteRecovery` (`features/notes/NoteRecovery.tsx`, hook `useNoteRecovery.ts`): shown when a pending write failed or a note file error is classified (`lib/noteFileErrors.ts`: `note_file_missing_or_moved`, `note_file_changed_externally`, `note_file_invalid_metadata`, `note_file_identity_conflict`). Shows explanation, diagnostic detail (`NoteFileDiagnosticDetail`), read-only textarea with retained Markdown, "Copy" (fallback: select text + "copy manually" status), link "Open Settings at Rebuild note index" (`/settings#rebuild-heading`, `NoteFileSettingsLink`), "Retry" or "Retry after reconciling files". Used by BlockNote editor and canvas editor.

`NoteDetailError` (route error component): "Note unavailable" + guidance or raw message, links "Back to meeting library" (`/meetings`), "Open notes" (`/notes`), rebuild settings link (file errors), "Try again" (router invalidate).

Embedded variant: `NoteEditor variant="embedded"` is used by `features/sessions/SessionNotes.tsx` (meeting session workspace, out of scope): no header, no backlinks, menu without Duplicate/Move to Trash, BlockNote dictionary localized (standalone is English-only BlockNote UI).

##### 1.3 Home: route `/home` (unreachable)
File: `routes/HomeRoute.tsx` -> `features/home/HomeCanvas.tsx` + side panel `features/home/HomePanel.tsx`. Data `features/home/fixtures.ts` `useHome()`.
- HomeCanvas: greeting by hour (morning/afternoon/evening) + empty first name; date + "N things today"; things-today cards (always empty -> "home.thingsToday.empty"); "Continue" recents = 8 most recently updated real notes (links `/notes/$id`).
- HomePanel: "Messages" and "News" sections, always empty lists.
- No IPC of its own (reads store notes from `list_notes`). `homeFixture` constant (Portuguese demo data) is dead. Root `navigate` event route `home` and global shortcut `open_app` go to `/` (board), not `/home`. Locale `home` object in en.json is `{}` at top level (keys are nested).

##### 1.4 Agenda: route `/agenda`
File: `routes/AgendaRoute.tsx` -> `features/agenda/AgendaView.tsx` + side panel `features/agenda/AgendaPanel.tsx` (static text: "Outlook", invitee hint, "Calendar events do not start recording…").
Purpose: show cached Outlook events (next 30 days) and copy an event's invitees as speaker candidates into a recorded library meeting.

States: disconnected / needs reconnect (renders `OutlookConnectionCard`), connecting ("Waiting for completion…" + "Cancel connection"), connected (header buttons), busy, error alert + "Retry", freshness line "Local cache updated {date}", empty "No cached appointments…".

| Control | Effect | IPC |
|---|---|---|
| Header "Configure" (connected) | Navigate `/settings#integrations-heading` | none |
| Header "Sync now" (connected) | Refresh cache | `calendar_sync` |
| Event row "Review invitees" | Opens review card, loads library meetings | `library_list` |
| Review card: invitee chips, "Choose a library meeting" select, "Add candidates to selected meeting" | Merge invitees (dedupe by email or name, cap 100) into meeting participant context | `library_participant_context`, `library_set_participant_context` |
| (via card) Connect / Disconnect / Cancel / Retry / client ID & tenant | see 1.5 | `calendar_*` |

##### 1.5 OutlookConnectionCard (shared)
File: `features/agenda/OutlookConnectionCard.tsx`, state hook `features/agenda/useOutlookConnection.ts`, IPC wrapper `features/agenda/calendar.ts`. Used by AgendaView (when not connected) and `features/settings/IntegrationsSection.tsx` (with "Open agenda" button).
| Control | Effect | IPC |
|---|---|---|
| Status badge | Connected / Reconnect needed / Disconnected | `calendar_status` on mount (local cache only) |
| Account + freshness lines | Read-only | |
| "Advanced" details: Application (client) ID, Tenant (default `organizations`); open automatically if no build-time client ID | Saved to localStorage `outlook.clientId`, `outlook.tenant` on connect | |
| "Connect Outlook" | `calendar_begin` -> opens browser (`plugin-shell open`) -> `calendar_complete`; on failure `calendar_cancel` | `calendar_begin`, `calendar_complete`, `calendar_cancel` |
| "Cancel connection" (while connecting) | Abort attempt | `calendar_cancel` |
| "Disconnect and remove cache" (connected or cached) | Clears tokens + cache (no confirm) | `calendar_disconnect` |
| "Open agenda" (Settings only) | Navigate `/agenda` | |
| "Sync now" | Refresh | `calendar_sync` |
| Error alert "Retry" | Re-read status | `calendar_status` |
Unmount cancels an unfinished authorization.

##### 1.6 Meeting detection (global)
- `features/detection/CallDetectionController.tsx` (mounted in `routes/__root.tsx`, renders nothing): writes preference via `set_call_detection_enabled` on mount/change, then polls every 3 s `call_detection_status` + `library_status`. Backend also emits `call-detected` (`src-tauri/src/call_detector.rs:136`) but the frontend never listens (polling only). `get_active_calls` is not used.
- Store `features/detection/meetingDetection.ts`: enabled (localStorage `coxinha:meeting-detection`, default on), status, failed, recording, dismissed keys, tracked call, call-ended prompt, alerted next-call keys. Focuses/unminimizes main window when a call ends or a second call appears during recording.
- Orchestration `features/detection/directCapture.ts`: `recordDetectedCall` (checks still detected -> `library_status` busy check -> `library_sources` default mic+output via `selectDevice` -> `library_create_session` (status planned, times from invitation) -> `library_start_session` -> optional `library_set_participant_context` with invitees+organizer); `stopDetectedCallRecording` (`library_stop`); `switchToDetectedCall` (stop then record). Dispatches window event `coxinha:sessions-changed`. Errors: devicesMissing, callEnded, captureBusy, startFailed.

`MeetingReminder` (`features/detection/MeetingReminder.tsx`), a banner rendered at the top of every AppShell content area. Priority order:
| Banner | Condition | Text | Buttons (IPC) |
|---|---|---|---|
| Next call | Recording a detected call and another call appears | "A new call detected in {app}…" | "Start new meeting" (`library_stop` then full record flow), "Stop and save now" (`library_stop`), "Same meeting" (re-track) |
| Call ended | Tracked call disappears while recording | "{app} call ended…" | "Stop and save now" (`library_stop`), "Keep recording" |
| Receipt | Capture started from banner and sidebar RecordingStatus host not mounted | "Recording started: {title}" or metadataFailed alert | link "Open meeting" -> `/sessions/$sessionId`, "Dismiss notice" |
| Possible meeting | Enabled, not recording, call not dismissed | "A possible meeting was detected in {app}. Record it?" + "Uses your default microphone and computer audio." | "Yes, record" / "Starting recording…", "Ignore this call", "Meeting details" toggle |
`MeetingDetails` (`features/detection/MeetingDetails.tsx`): "Calendar invitation (optional)" select of nearby Outlook events (starting within 15 min, not ended, not cancelled/all-day; IPC `calendar_status`), title input (max 500, locked when an invitation is chosen), help/loading/failed text, "{count} invitees".

`DetectionSettings` (`features/detection/DetectionSettings.tsx`, embedded in `features/settings/SettingsView.tsx`): checkbox "Remind me when a possible meeting starts", description, alerts "unsupported (Linux PulseAudio/PipeWire only)" and "unavailable, retrying".

---

#### 2. Domain lifecycles (user view)

##### Note
| Step | Where | IPC |
|---|---|---|
| Create blank | Board "New activity" / "Free text" / double-click canvas (`ActivityBoard`, `useBoardCreation.ts`); command palette "New note" (`features/shell/CommandPalette.tsx`); tray "New note" and global shortcut -> `navigate` event `notes-new` (`routes/__root.tsx`) | `create_note` |
| Create copy | Note actions "Duplicate" (`NoteEditor.tsx`, `store.duplicateNote`) | `get_note`, `create_note`, `update_note` |
| Session personal note | Created by session flow (`library_ensure_personal_note`, out of scope) and edited embedded | |
| Daily note | `store.openDailyNote` -> `get_or_create_daily_note` exists but nothing calls it; Agenda's old daily-note strings remain in locale (`agenda.dailyHeading/loading/error`). No UI. | |
| View | `/notes/$id` (BlockNote or canvas), board card read view, session workspace (embedded), palette search results, backlinks list, Home recents (unreachable) | `get_note`, `list_notes` |
| Edit body | BlockNote (`NoteEditor`), canvas editor (`CanvasNote` on board and `ColoredNoteEditor`), embedded session editor | `update_note` |
| Title | Derived from first `#` heading; activity cards force a heading | |
| Tags | Derived from Markdown; shown as chips in `NoteHeader`. `list_tags`, `list_notes_by_tag` have no UI | |
| Backlinks | `BacklinksPanel` on standalone BlockNote view only | `get_backlinks` |
| Attachments | Image/file upload in BlockNote only (canvas editor has no image support) | `save_attachment` |
| Delete | Note actions "Move to Trash" (`NoteEditor.tsx`), command palette delete (`features/shell/CommandPalette.tsx:66`). Session notes refuse (`session_note_delete_requires_detach`). Permanent file removal. Board "Remove from board" does NOT delete the note | `delete_note` |
| Recover | `NoteRecovery`, `NoteDetailError`, Settings rebuild link | |

##### Board item / activity
Types (`features/board/model.ts`): `card` (activity: note-backed, progress 0-100, handles), `text` (note-backed free text, no progress), `area` (label + color, no note; aggregated progress of child cards). Edges: directed card->card dependencies.
| Step | Where |
|---|---|
| Create | Toolbar (New activity, Free text, Add area, Add existing note), canvas double-click, empty-state button |
| View | Canvas, MiniMap, inspector outline |
| Edit | Inline card editor; card footer progress; inspector fields (label, color, progress, parent area, geometry, layer); drag/resize; drag-into-area; dependencies via handles or inspector |
| Delete | Inspector "Remove from board" only (no node Delete key, no confirm); edges via inspector × or edge select + Delete |
| Persistence | `board_load` / `board_save` / `board_export_recovery`; conflict -> export + reload flow |
Progress rules (`hierarchy.ts`): area = mean of child cards, clamped 1-99 unless all 0 / all 100; colors grey 0, orange >0, blue >=50, green 100.

##### Calendar event (Outlook)
| Step | Where | IPC |
|---|---|---|
| Connect | `OutlookConnectionCard` in Agenda and Settings > Integrations | `calendar_begin/complete/cancel` |
| Sync (next 30 days) | Agenda header, card "Sync now" | `calendar_sync` |
| View | Agenda list; detection `MeetingDetails` invitation select | `calendar_status` |
| Use | Copy invitees to library meeting (Agenda); seed session title/times/participants when recording a detected call | `library_set_participant_context`, `library_create_session` |
| Delete | "Disconnect and remove cache" | `calendar_disconnect` |
Events are read-only; no event detail view; no link from event to session; no auto-record.

##### Detected call / meeting reminder
Detected by backend polling (`call_detection_status`), shown as `MeetingReminder` banner -> user records (creates session + starts capture), dismisses (per call key, in-memory), or opens details. During recording: call-ended and next-call prompts. Enabled/disabled in Settings (`DetectionSettings`). No history of detections.

---

#### 3. Duplications and inconsistencies (in scope)
1. Two note editors: BlockNote (`features/notes/NoteEditor.tsx`) vs TipTap canvas (`features/board/editor/CanvasNote.tsx`, `CanvasTextEditor.tsx`), with different features (attachments, slash menu, backlinks, actions menu only in BlockNote; text color only in canvas). `ColoredNoteEditor.tsx` silently switches `/notes/$id` to the canvas editor when color spans exist, losing header, menu and backlinks.
2. Two save debounce paths for the same note: BlockNote 500 ms vs canvas 400 ms, both via `lib/noteSessions.ts`; board itself 600 ms (`ActivityBoard.tsx`).
3. Note deletion in two places with different guards: `NoteEditor.tsx` (confirm, reuses `palette.deleteConfirm`) and `features/shell/CommandPalette.tsx:66`. "Move to Trash" label but backend permanently deletes (`src-tauri/src/storage/deletion.rs:30`).
4. Note creation in four entry points (board toolbar, canvas double-click, palette, tray/shortcut `notes-new`); board ones create a card, palette/tray ones create an orphan note not placed on the board.
5. Same route rendered twice: `/` and `/notes` both `NotesIndexRoute` (`router.tsx`). `/home` duplicates "home" concept but is unreachable; IPC route `home` goes to `/`.
6. Outlook connection UI in two places: `AgendaView.tsx` (only when disconnected, plus its own Sync/Configure header buttons duplicating the card's) and `features/settings/IntegrationsSection.tsx`. Freshness line and error/Retry alert are rendered twice in Agenda code paths (`AgendaView.tsx` and `OutlookConnectionCard.tsx`).
7. Calendar data surfaces: Agenda event list (`features/agenda/AgendaView.tsx`) vs sessions calendar (`features/sessions/CalendarView.tsx`, out of scope) vs detection invitation picker (`MeetingDetails.tsx`); three separate readers of `calendar_status`, no shared cache.
8. Recording start in detection banner (`directCapture.ts`) reimplements device selection and session creation also done in sessions/meetings capture UI (`features/sessions/SessionRecording.tsx`, `features/meetings/CaptureSection.tsx`). Stop recording also exposed in `components/AppShell/RecordingStatus.tsx`.
9. Board "Open" duplicated: inspector "Open", card pencil, double-click, Enter; but no way to open a board card's note in the full `/notes/$id` page from the board.
10. Front/back layer controls appear both on the node (when selected) and in inspector fields.
11. Progress editable in two places (card footer only while editing, inspector field).
12. Keyboard hints shown but unbound: `Ctrl+L`, `Ctrl+D` in `NoteActionsMenu.tsx`. Kbd hint shows `⌘.` in standalone even on Windows/Linux (`NoteEditorFrame.tsx`).
13. i18n split: board strings in `features/board/locale.ts` instead of `locales/*.json`; standalone BlockNote UI not localized (dictionary only set for embedded variant).
14. README contradiction: `features/board/README.md` says moving an area does not move cards and inspector edits card colors; code moves children (`hierarchy.patchItem`) and only areas have a color field.
15. Word count is computed from initial Markdown, not live (`NoteEditor.tsx`).
16. Detection is polled every 3 s although backend emits `call-detected`.

#### 4. Dead or unreachable (verified by grep, excluding tests)
| Item | File | Note |
|---|---|---|
| `BoardNotePanel` | `features/board/BoardNotePanel.tsx` (+ `boardNotePanel.css`) | Not imported; old side-panel editor for board cards (BlockNote embedded) |
| `useAgenda`, `agendaFixtures`, `AgendaEvent` | `features/agenda/fixtures.ts` | Not imported |
| `homeFixture`, `__isFixture` | `features/home/fixtures.ts` | Only `useHome` is used |
| `HomeRoute` / `HomeCanvas` / `HomePanel` | `routes/HomeRoute.tsx`, `features/home/*` | Route `/home` registered, no link/palette/IPC target |
| `store.openDailyNote`, `setActiveNote`, `activeNoteId`, `searchNotes` | `lib/store.ts` | Never called; daily note has no UI |
| Meeting slash command | `features/meetings/slashCommand.ts` | Not imported; `meeting` block in schema has no insertion path |
| Unused locale keys | `locales/en.json` `noteMenu.*` (archive, present, lock, AI, translate, export, version history, copied toasts), `agenda.dailyHeading/loading/error/comingSoon`, `backlinks.error` | |
| Event `call-detected` | `lib/bindings.ts` `events.callDetected` | No listener |
| `get_active_calls`, `list_tags`, `list_notes_by_tag`, `get_or_create_daily_note` (no UI) | `lib/bindings.ts` | Backend only |

#### Counts (scope)
- Screens/routes: 4 routes (`/`, `/notes`, `/notes/$noteId`, `/agenda`) + 1 unreachable (`/home`); 1 global banner system.
- Major panels: 20 (board, toolbar, inspector, fields, card node, area node, canvas editor, note editor, frame, header, actions menu, backlinks, recovery, route error, home canvas, home panel, agenda view, agenda panel, Outlook card, reminder+details).
- User actions catalogued: about 75.
- IPC commands used in scope: 26 (`board_load`, `board_save`, `board_export_recovery`, `create_note`, `update_note`, `delete_note`, `get_note`, `list_notes`, `get_backlinks`, `save_attachment`, `calendar_status`, `calendar_begin`, `calendar_complete`, `calendar_cancel`, `calendar_sync`, `calendar_disconnect`, `call_detection_status`, `set_call_detection_enabled`, `library_status`, `library_sources`, `library_stop`, `library_list`, `library_participant_context`, `library_set_participant_context`, `library_create_session`, `library_start_session`), i.e. 26 counting the library ones touched by agenda/detection. IPC events: none listened in scope (desktop events and `navigate` handled in root/lifecycle).

### 2.B Meetings, sessions, people, calendar (Part B)

Scope: `src/features/meetings/*`, `src/features/sessions/*`, routes `SessionRoute`, `MeetingsRoute`, `PeopleRoute`, `CalendarRoute`. Repo the repository root, branch `feat/0058-meeting-library`. Tests skipped. Labels quoted from `src/locales/en.json`.

IPC note: none of the commands below are in `src/lib/bindings.ts` (stale; only legacy note/meeting commands are typed there). All are raw `invoke()` calls wrapped by four modules:

| Wrapper | File | Commands |
|---|---|---|
| `library.*` | `src/features/meetings/library.ts` | `library_list`, `library_sources`, `library_status`, `library_start`, `library_pause`, `library_stop`, `library_detail`, `library_recover`, `library_import_audio`, `library_processing`, `library_process`, `library_recognition`, `library_participant_context`, `library_set_participant_context`, `library_create_person`, `library_confirm_speaker`, `library_revoke_assignment`, `library_edit_segment` |
| `voiceCuration.*`, `voiceComparison` | `src/features/meetings/voiceCuration.ts` | `library_enrollment_candidates`, `library_enroll_selected_turns`, `library_voice_profiles_page`, `library_person_samples_page`, `library_revoke_voice_sample`, `library_voice_comparison`; plus v1 `library_voice_profiles` and `library_person_samples` (wrapped, **never called**) |
| `sessions.*` | `src/features/sessions/sessions.ts` | `library_sessions`, `library_session`, `library_create_session`, `library_update_session`, `library_ensure_personal_note` |
| `startSessionCapture` | `src/features/sessions/sessionCapture.ts` | `library_start_session` |

Also `commands.getNote` (typed binding, `get_note`) in `SessionNotes.tsx`. No Tauri events are listened to in this scope. All live state comes from **polling**: `library_status` every 250 ms (LibraryView, only while active/processing) and every 1 s (SessionRecording, always). `library_sessions` runs every 3 s (useSessions, global). `library_session` runs every 3 s (SessionRoute).

Every screen checks `isTauri()` first. In a browser it shows "desktop required" (`library.desktopRequired`) and nothing else works.

Client caches (zustand, in-memory unless noted):
- `sessionListCache` (`sessions.ts`): session list, shared by the sidebar, calendar and RecordingStatus. It is invalidated by the window event `coxinha:sessions-changed`.
- `sessionCaptureCache` (`sessionCapture.ts`): sessionId→meetingId acknowledgement after a successful `library_start_session`.
- `useSessionNavigation` (`sessionNavigation.ts`): sidebar period, calendar period, transcript filter, month, selectedDay, view.
- `useSessionSidebarPreferences` (`sidebarPreferences.ts`): collapsed day groups. **Persisted to localStorage** under `coxinha:session-sidebar`.

---

#### 1. Routes and screens

##### 1.1 `/meetings`: Meeting library (`src/routes/MeetingsRoute.tsx` → `src/features/meetings/LibraryView.tsx`)
Purpose: a standalone capture/import utility and the recordings list (title "Meeting library"). It is independent of sessions and notes ("No note is required"). The AppShell shows one chrome tab, "Meeting library".

Layout: PageHeader, then CaptureSection, then a 2-column grid (Recordings list | Recording detail).

| Control | Action | IPC |
|---|---|---|
| Mount | loads sources, recordings, status in parallel | `library_sources`, `library_list`, `library_status` |
| Meeting title input | free text; required for Start/Import | none |
| Microphone / Output monitor selects | pick capture devices (non-monitor vs monitor sources); default shown as "· System default" | none |
| "Refresh devices" | re-enumerate devices, keep selection | `library_sources` |
| "Use system defaults" | re-enumerate and reset to OS defaults | `library_sources` |
| "Start recording" | start a capture that is not tied to a session. Disabled unless title + valid mic≠output + no processing | `library_start` |
| "Pause"/"Resume" | toggle pause | `library_pause` |
| "Stop and save" | stop capture | `library_stop` |
| "Import local WAV" | native file dialog (`@tauri-apps/plugin-dialog`, .wav). Creates a recording with the typed title and auto-selects it | `library_import_audio` |
| Recordings "Refresh" | refreshes sources + status | `library_sources`, `library_status`, then `library_list` |
| Recording row (button, aria-pressed) | selects and loads its detail into the right pane | `library_detail` |
| RecordingDetail (right pane) | see 1.5 | |

States:
- desktop-required, devices loading/failed, "no monitor source" hint
- idle, recording (elapsed s + 2 level meters with diagnostics), paused
- processing (Start/Import disabled)
- error banner (merged local + `status.error`)
- empty list ("No recordings loaded."), detail placeholder ("Select a recording…" / loading)

Row subtitle shows `createdAt` · capture state (New / Capture open / Saved / Interrupted).

Navigation out: none. There is **no link from a recording to its session** or note.

##### 1.2 `/sessions/$sessionId`: Session workspace (`src/routes/SessionRoute.tsx`)
Purpose: the single page for one meeting session. It holds notes, recording controls, transcript, summary and speakers. Breadcrumb: "Session workspace".

| Control | Action | IPC |
|---|---|---|
| Mount / every 3 s | load session | `library_session` |
| SessionHeading pencil "Rename session" | inline form: title + "Save" / "Cancel" / Esc | `library_update_session` |
| "Open agenda" link (heading) | navigate `/agenda` | none |
| Tabs "My notes / Transcript / Summary / Speakers" | ARIA tablist; Arrow/Home/End keys | none |
| SessionRecording (always visible above tab panels) | see 1.3 | |
| Notes tab | SessionNotes (1.4) | |
| Summary tab | static EmptyState "No summary generated…" (no feature) | none |
| Transcript / Speakers tabs without recording | EmptyState (`session.transcriptEmpty` / `speakers.noRecording`) | none |
| Transcript / Speakers tabs with recording | rendered by RecordingDetail/ProcessingPanel inside SessionRecording | |

States: desktop-required, loading, load failed (+Retry), stale-with-error banner, loaded. Session `status` (planned/active/completed/cancelled) is shown read-only. **No UI edits status, starts_at or ends_at.**

##### 1.3 SessionRecording (`src/features/sessions/SessionRecording.tsx`)
This is the compact recording strip inside the session.

| Control | Action | IPC |
|---|---|---|
| Status label | Recording / Paused / capture state / "recording pending" / "no audio" | polls `library_status` 1 s |
| Pause/Resume, "Stop and save" (only when this session owns the active capture) | transport controls | `library_pause`, `library_stop` |
| "Recording controls" toggle (chevron) | expands the embedded CaptureSection (fixedTitle, no import, no title field) | `library_sources` on open |
| Embedded "Start recording" | starts a capture bound to this session | `library_start_session` |
| "Playback" toggle (if audio exists) | shows/hides the joint player + individual tracks | none |
| "Open capture and import" link | navigate `/meetings` (import is only there; "Importing audio creates a separate session.") | none |
| Error banner Retry | re-poll + reload sources + refresh session | `library_status`, `library_sources`, `library_session` |
| Recover (via RecordingDetail) | recover an interrupted capture | `library_recover` |

States:
- no audio, recording-pending (acknowledged but metadata stale)
- recording, paused
- "another capture is active" (info; start is blocked)
- "recording already exists" (one recording per session)
- processing phase
- audio failed / active audio failed

Loads detail with `library_detail` when `meeting_id` is known.

##### 1.4 SessionNotes (`src/features/sessions/SessionNotes.tsx`)
- Lazily creates/ensures the session's personal Markdown note (`library_ensure_personal_note`), then loads it (`get_note`) and renders `NoteEditor variant="embedded"` from `src/features/notes`.
- Injects the note into the global notes store so search finds it.
- States: skeleton, error ("note failed" + file diagnostic + Settings link + Retry), editor.

##### 1.5 RecordingDetail (`src/features/meetings/RecordingDetail.tsx`)
Shared by LibraryView (full) and SessionRecording (compact, `processingPanelId`, `people`).

| Control | Action | IPC |
|---|---|---|
| RecordingInformation | elapsed/duration/size, "Local files" details | none |
| JointPlaybackControls | play both tracks in sync | none (HTML audio via `library.audioUrl` loopback/asset) |
| "Individual tracks" details | one native `<audio controls>` per track (mic/output/imported). Opening it releases joint playback | none |
| "Recover interrupted capture" (state recording/interrupted and no active capture) | recover | `library_recover` |
| ProcessingPanel | see 1.6 | |
| Seek from transcript/speaker | reveals audio, opens individual tracks, focuses the player at time | none |

Warnings: an empty track (`frames===0`), and the manifest alignment text. A playback error shows an alert.

Views: `legacy` (Library), `transcript` (Session Transcript tab), `people` (Session Speakers tab).

##### 1.6 ProcessingPanel (`src/features/meetings/ProcessingPanel.tsx` + `useProcessing.ts`)
"Local processing" means transcription + diarization. Not shown in the people view.

| Control | Action | IPC |
|---|---|---|
| Mount / status change | load jobs + report | `library_processing` |
| "Open local configuration file" (file input .json) | loads a model-config JSON. **The user must supply the model paths, sha256 and provenance by hand** | none |
| "Advanced configuration" details + textarea | edit the raw config JSON; parsed models are listed (path/provenance/SHA) | none |
| "Process recording" / "Retry processing" | starts a job. Disabled while capturing, while processing, if the capture is not closed, or if the config is empty | `library_process` |
| Error alert Retry | reload | `library_processing` |
| Job list | state (Pending/Running/Completed/Failed) · attempts · error | none |
| "Processing version" select (if >1 succeeded job) | choose which job's report to view | `library_processing(jobId)` |
| Transcript segment header button | track · mm:ss · speaker name (confirmed) or anonymous. Click seeks audio | none |
| "Separate human correction" textarea + "Save correction" per segment | stores a correction next to the ASR text | `library_edit_segment` |
| SpeakerReview (hidden in transcript view, shown in legacy/people) | see 1.7 | |
| People view: "Open Transcript" | switch to the Transcript tab | none |
| People view "processing details" details | notes + version selector + Open Transcript | none |

States: no data/loading, capture busy, running, failed (retry), succeeded with report, warnings (experimental clustering, overlap; matched against **hardcoded English backend strings**), "pending speakers" during reprocessing.

##### 1.7 SpeakerReview (`src/features/meetings/SpeakerReview.tsx`)
| Control | Action | IPC |
|---|---|---|
| Mount / after each curation | load recognition suggestions | `library_recognition` |
| Recognition status line | unavailable / pending / calibrated / no calibration | none |
| Retry (on error) | reload recognition | `library_recognition` |
| SpeakerCard grid (one per track×speaker, excluding "unknown") | see 1.8 | |
| VoiceProfilesPanel (collapsed `<details>`, "Private voice memory") | see 1.10 | |
| VoiceComparisonPanel (`<details>`) | see 1.12 | |
| "Add a person / agenda names" | opens PersonFormSheet with ParticipantContext as suggestions | `library_create_person` |
| Legacy assignments section (assignments without track) | "Previous decision origin" input + "Revoke previous identity" per confirmed one | `library_revoke_assignment` |

##### 1.8 SpeakerCard (`src/features/meetings/SpeakerCard.tsx`)
One card per diarized speaker per track.

| Control | Action | IPC |
|---|---|---|
| Header | "Confirmed: name" or anonymous | none |
| Suggestion (calibrated only) + "select suggestion" | prefill the person | none |
| "Listen · m:ss–m:ss" / Pause | play the cleanest isolated turn (≤12 s, `speakerExcerpt.ts`) | none |
| Person select | choose a person (homonyms disambiguated by id suffix) | none |
| "Decision origin" input (required) | free-text human justification | none |
| "Confirm identity" / "Correct identity" | assign the person to the speaker | `library_confirm_speaker` |
| "Revoke identity and voice contributions" (if confirmed) | revoke | `library_revoke_assignment` |
| SelectedVoiceEnrollment (if confirmed) | see 1.9 | |

##### 1.9 SelectedVoiceEnrollment (`src/features/meetings/SelectedVoiceEnrollment.tsx`)
A `<details>` titled "Choose voice samples to remember".

| Control | Action | IPC |
|---|---|---|
| Open | load turn candidates | `library_enrollment_candidates` |
| "Refresh" | reload | same |
| Turn checkbox (max 128; disabled when ineligible, with reasons) | select turns | none |
| Listen/Pause per turn (≤12 s) | preview | none |
| "Enrollment origin" input (validated) | required justification | none |
| "Enroll selected (n)" | save the voice samples | `library_enroll_selected_turns` |

States: loading, error, stale assignment, no turns, ineligible reasons, already-enrolled count.

##### 1.10 VoiceProfilesPanel (`src/features/meetings/VoiceProfilesPanel.tsx`)
Two modes: embedded (collapsed details in SpeakerReview) and `standalone` (People page).

| Control | Action | IPC |
|---|---|---|
| Open / version change | paged load of people (25/page) | `library_voice_profiles_page` |
| Search (standalone only) | client-side filter by name/id over **loaded pages only** | none |
| "Refresh" / "Restart" (if stale) | restart paging | same |
| "Load more people" | next page | same |
| Empty state + "Add person" (standalone) | open PersonFormSheet | none |
| Person rows | PersonVoiceSamples (1.11) | |

States: loading, stale view (generation changed), error, partial/complete counts, empty, no match.

##### 1.11 PersonVoiceSamples (`src/features/meetings/PersonVoiceSamples.tsx`)
A `<details>` per person, showing "name · personId".

| Control | Action | IPC |
|---|---|---|
| Open | paged samples (50/page) | `library_person_samples_page` |
| "Refresh"/"Restart" | reload | same |
| Stats | active/revoked/invalidated counts; per embedding-space count + duration (VoiceSpaceInfo) | none |
| "Revoke origin" input (required) | justification | none |
| Per sample: sampleId · state, space, meetingId · track · times, revision, created/revoked UTC; "Revoke this sample" (active only) | revoke | `library_revoke_voice_sample` |
| "Load more samples" | next page | same |

**No rename and no delete for people.** Raw ids are exposed (personId, sampleId, meetingId).

##### 1.12 VoiceComparisonPanel (`src/features/meetings/VoiceComparisonPanel.tsx`)
A `<details>` titled "Experimental cross-meeting comparison". Open/Refresh calls `library_voice_comparison`. Per speaker and per embedding space it shows status, candidates (name · id, mean/max cosine, support turns/duration/samples) and a nested "turn evidence" list. Read-only.

##### 1.13 ParticipantContext (`src/features/meetings/ParticipantContext.tsx`)
"Manual participant candidates" per meeting. Used only as the suggestions slot of PersonFormSheet inside SpeakerReview.

| Control | Action | IPC |
|---|---|---|
| Mount | load candidates | `library_participant_context` |
| Retry candidates | reload | same |
| Rows: Name, Email inputs | edit locally | none |
| "Copy name to new person" | fills PersonFormSheet name | none |
| "Remove candidate" | remove row locally | none |
| "Add candidate" | add empty row | none |
| "Save local candidates" | persist list | `library_set_participant_context` |

The same IPC is also written by **AgendaView** (`src/features/agenda/AgendaView.tsx`: link Outlook invitees to a recording) and by **directCapture** (`src/features/detection/directCapture.ts`: invitees on auto-start).

##### 1.14 PersonFormSheet (`src/features/meetings/PersonFormSheet.tsx`)
A side Sheet dialog titled `peopleDirectory.form.title`. Fields: Person name (required), Consent origin textarea (required, validated: non-empty, no control chars, ≤1000 bytes). Optional suggestions slot. Buttons: Cancel, "Create person" (`library_create_person`). Shows the blocking reason text. Used by PeopleDirectory and SpeakerReview.

##### 1.15 `/people`: People & voices (`src/routes/PeopleRoute.tsx` → `src/features/meetings/PeopleDirectory.tsx`)
Purpose: the global registry of people and voice samples ("One local registry for all meetings").
- Header action "Add person" opens PersonFormSheet (`library_create_person`). Shows a success alert "created {name}".
- Body: VoiceProfilesPanel standalone (1.10/1.11) plus a training footnote.
- States: desktop-required, error, created, list states from 1.10.
- Navigation out: none (sample meetingIds are plain text, not links).

##### 1.16 `/calendar`: Calendar (`src/routes/CalendarRoute.tsx` → `src/features/sessions/CalendarView.tsx`)
Purpose: browse all sessions by date (month grid or grouped list). Data is `library_sessions` via the shared cache.

| Control | Action | IPC |
|---|---|---|
| Header "Outlook agenda" link | navigate `/agenda` | none |
| CalendarToolbar: Period selector (All/Today/This week/This month/Last 30 days/Custom) | filter + jump month | none |
| Custom range: From/Through date inputs, Apply/Cancel, edit pill (pencil) | custom period with validation | none |
| Transcript filter (All / With transcript / Without transcript) | filter | none |
| "Reset" | period=all, transcript=all | none |
| Month nav ◀ / "Today" / ▶ | change month (Today also selects today) | none |
| View toggle Month / List | switch view | none |
| CalendarHelp ("Help" details) | 6 help paragraphs | none |
| "N undated" anchor link | jump to the undated section | none |
| Skip link "skip days" | jump to day detail | none |
| CalendarMonth day button | select day; day detail lists SessionEntry rows | none |
| Out-of-month alert: "Go to period" / "Reset" | jump to the first month of the period / reset | none |
| SessionEntry (day detail, list view, undated section) | navigate `/sessions/$id` | none |
| Error alert Retry | refetch | `library_sessions` |

States: desktop-required, loading, error, no sessions, no matches, month empty / sessions outside month, day not selected, day empty, undated empty. Day cells show count + coverage "available/without/uncertain".

**No create-session action here**, even though it is a calendar.

##### 1.17 Sidebar session list (embedded in the AppShell rail: `src/components/AppShell/Rail.tsx` → `src/features/sessions/SessionSidebar.tsx`)
Visible on every route that uses AppShell.

| Control | Action | IPC |
|---|---|---|
| Section header "Sessions" | label | none |
| SidebarPeriodFilter (sliders icon, dot when active) | popover dialog with PeriodSelector (compact). Esc / click-outside closes | none |
| "+" "New meeting" | toggles inline form: Title input (max 500) + "Create" → creates a planned session and navigates to it | `library_create_session`, then `library_sessions` |
| Day group header (chevron, compact) | collapse/expand day (persisted in localStorage) | none |
| SessionEntry compact | REC pulse badge, title, time ("recorded" prefix if date comes from recording), icons for audio / transcript / status / processing / note-error, "failed" tag; click → `/sessions/$id`; `aria-current` when open | none |
| "Reset" (when filter hides everything) | sidebarPeriod=all | none |
| Retry on error | refetch | `library_sessions` |

States: desktop-required (disabled "New meeting"), loading, error, empty, all filtered out.

##### 1.18 Smaller presentational pieces
- **CaptureSection** (`src/features/meetings/CaptureSection.tsx`): controlled form (title, device selects, refresh/defaults, live meters with diagnostics Receiving / Silence / Waiting / Stalled / Error / Paused, Start/Pause/Resume/Stop/Import). It performs no IPC itself. Used in LibraryView (full) and SessionRecording (fixedTitle, no import, no title).
- **RecordingInformation** (`src/features/meetings/RecordingInformation.tsx`): elapsed, duration, size, processing phase ("validating / stopping / processing · no estimate"), "Local files" details with folder path, "Copy folder path" (clipboard) and a file list with sizes.
- **JointPlaybackControls** (`src/features/meetings/JointPlaybackControls.tsx`, hook `useJointPlayback.ts`): Listen/Pause, time / duration, volume slider, position slider, loading/buffering/error notice, and a "joint" notice when there are multiple tracks.
- **useBoundedPlayback** (`useBoundedPlayback.ts`): excerpt playback (start/end) shared by speaker cards and enrollment.
- **MeetingCard / MeetingBlock** (`MeetingCard.tsx`, `MeetingBlock.tsx`): a BlockNote custom block `meeting` registered in the NoteEditor schema (`src/features/notes/NoteEditor.tsx:36`). It renders **fixture data** (`src/features/meetings/fixtures.ts`, `__isFixture = true`) with Summary / Transcript / Action items tabs, or "not found" + Unlink. There is no real-data path, and its inserter `buildMeetingSlashItem` (`slashCommand.ts`) is never wired. MeetingCard is otherwise only used in `src/routes/DevShellPreviewRoute.tsx` (DEV only).

---

#### 2. Domain lifecycles (as the user sees them)

##### Meeting session (`Session`, `sessions.ts`)
| Step | Where |
|---|---|
| Create (manual, planned, untitled date) | Sidebar "+" form `src/features/sessions/SessionSidebar.tsx` (`library_create_session`) |
| Create (auto) | Detection direct capture `src/features/detection/directCapture.ts` (`library_create_session` + `library_start_session`). Also `origin: 'recording'` sessions appear from captures/imports made in `/meetings` (backend-created; import note says "creates a separate session") |
| List | Sidebar `SessionSidebar.tsx`/`SessionList.tsx`; Calendar `CalendarView.tsx`; RecordingStatus pill (out of scope) reads `sessionListCache` |
| View | `/sessions/$id` `src/routes/SessionRoute.tsx` |
| Edit | Title only: `SessionHeading.tsx` (`library_update_session`). Status, starts_at and ends_at have **no UI** (the IPC accepts them) |
| Delete/cancel | **None** (no delete IPC; status `cancelled` cannot be set from UI) |

##### Recording (`LibraryMeeting` + `LibraryDetail`, states new/recording/finished/interrupted)
| Step | Where |
|---|---|
| Create via capture (no session) | `/meetings` CaptureSection → `library_start` (`LibraryView.tsx`) |
| Create via capture (bound to a session) | SessionRecording → `library_start_session` (`sessionCapture.ts`); detection auto-start (`directCapture.ts`) |
| Create via import WAV | `/meetings` only, `library_import_audio` (`LibraryView.tsx`) |
| Pause/Resume/Stop | LibraryView/CaptureSection, SessionRecording strip, RecordingStatus pill (out of scope, `src/components/AppShell/RecordingStatus.tsx`), detection auto-stop (`directCapture.ts`) |
| Recover interrupted | RecordingDetail "Recover interrupted capture" (`library_recover`), in both Library and Session |
| View/play | RecordingDetail (Library full, Session compact + "Playback" toggle) |
| Files | RecordingInformation "Local files" + copy path |
| Delete | **None** |

##### Processing job / transcript (`ProcessingDetail`, job states pending/running/succeeded/failed)
| Step | Where |
|---|---|
| Start/retry | ProcessingPanel "Process recording" (`library_process`), needs a hand-supplied JSON model config. Visible in Library detail and the Session Transcript tab |
| Progress | `CaptureStatus.processing` (phase) via polled `library_status`; RecordingInformation status line; SessionEntry processing icon; job list in ProcessingPanel |
| View transcript | ProcessingPanel segments (Library detail, Session Transcript tab). Click-to-seek |
| Edit | "Separate human correction" per segment (`library_edit_segment`). The original ASR text is immutable |
| Versions | "Processing version" select (older succeeded jobs) |
| Delete | **None** |
| Summary | Session Summary tab is a permanent placeholder; there is no summary feature in this scope |

##### Speaker (diarized track×speaker) and assignment
| Step | Where |
|---|---|
| Created by | processing job (`report.turns`) |
| View | SpeakerReview/SpeakerCard: Library detail (legacy view) and Session "Speakers" tab |
| Suggest | `library_recognition` (only shown when calibrated) |
| Confirm/correct identity | SpeakerCard (`library_confirm_speaker`, requires decision origin) |
| Revoke | SpeakerCard (`library_revoke_assignment`); legacy track-less assignments in SpeakerReview |

##### Person
| Step | Where |
|---|---|
| Create | PersonFormSheet from `/people` header/empty-state (`PeopleDirectory.tsx`) and from SpeakerReview "Add a person / agenda names" (`SpeakerReview.tsx`); consent origin required |
| Name suggestions | ParticipantContext (manual candidates, saved per meeting) |
| List/search | VoiceProfilesPanel (standalone on `/people`; collapsed in SpeakerReview) |
| Edit / rename / delete / merge | **None** |

##### Voice profile / voice sample
| Step | Where |
|---|---|
| Create samples | SelectedVoiceEnrollment inside a confirmed SpeakerCard (`library_enroll_selected_turns`, requires origin) |
| View profile | PersonVoiceSamples (`library_person_samples_page`), under VoiceProfilesPanel on `/people` or in SpeakerReview |
| Compare | VoiceComparisonPanel (`library_voice_comparison`), in SpeakerReview only |
| Revoke sample | PersonVoiceSamples "Revoke this sample" (`library_revoke_voice_sample`, requires origin); bulk: SpeakerCard "Revoke identity and voice contributions" |
| Delete | None (revocation only, kept for audit) |

##### Session personal note
Created lazily when the Notes tab opens (`library_ensure_personal_note`, `SessionNotes.tsx`). It is edited with the embedded NoteEditor. Its error state links to Settings.

---

#### 3. Duplications and inconsistencies (within scope)

1. **Recording start lives in three places with different semantics.**
   - `/meetings` CaptureSection → `library_start` creates a recording without a session (`LibraryView.tsx`).
   - Session strip → `library_start_session` (`SessionRecording.tsx`).
   - Detection auto-start (`src/features/detection/directCapture.ts`).

   Pause/Stop is exposed in four places: LibraryView, SessionRecording, RecordingStatus pill (`src/components/AppShell/RecordingStatus.tsx`), and directCapture.
2. **Two independent status pollers.** LibraryView polls `library_status` at 250 ms only while active; SessionRecording polls at 1 s always. RecordingStatus and CallDetectionController poll too (out of scope). Each keeps its own `CaptureStatus` state with no shared store.
3. **Import is only in `/meetings`.** Session capture hides it (`allowImport={false}`) and links out ("Open capture and import"). Import then creates a *separate* session, so the user cannot attach audio to an existing session.
4. **RecordingDetail is rendered in two modes.**
   - Library: full, with the transcript and SpeakerReview stacked together (legacy view).
   - Session: compact, split into Transcript and Speakers tabs.

   The same transcript, correction, speaker-confirm and processing controls therefore appear in both `/meetings` and `/sessions/$id`.
5. **Person creation lives in two places**, both using PersonFormSheet: `/people` (`PeopleDirectory.tsx`) and SpeakerReview (`SpeakerReview.tsx`). The voice-profile list is likewise duplicated: standalone on `/people` and as a collapsed details in every SpeakerReview (`VoiceProfilesPanel.tsx`).
6. **Participant candidates have three writers to one IPC** (`library_set_participant_context`): ParticipantContext (manual form), AgendaView invitee link (`src/features/agenda/AgendaView.tsx`) and directCapture (auto).
7. **Three date-browsing surfaces for sessions.** The sidebar list (own period filter, persisted collapse), the Calendar month grid and the Calendar list view each have separate period state (`sidebarPeriod` vs `calendarPeriod`). On top of that there is a separate `/agenda` (Outlook) linked from both Calendar ("Outlook agenda") and SessionHeading ("Open agenda").
8. **SessionEntry renders two layouts** (compact sidebar vs full calendar) with different icon/text vocabularies for the same status (`SessionList.tsx`).
9. **Session creation exists only in the sidebar "+".** The Calendar has no create action, and the LibraryView row list does not link to the session it belongs to.
10. **Fixture data in a production path.** The `meeting` BlockNote block is registered in the real NoteEditor schema (`src/features/notes/NoteEditor.tsx:36`) and renders `fixtures.ts` content via MeetingCard. The "meeting" concept here (summary/transcript/action items tabs) is a third, unrelated model next to LibraryMeeting and Session.
11. **Duplicated helpers.** Three time formatters for the same purpose: `formatTime` in `ProcessingPanel.tsx` and `SpeakerCard.tsx`, `voiceTime` in `voiceControls.tsx`, and `audioTime` (hh:mm:ss) in `RecordingInformation.tsx`. There are also two button styles: raw `<button className={voiceButton}>` (SpeakerCard, SpeakerReview, VoiceComparisonPanel, SelectedVoiceEnrollment, SessionSidebar) vs the `Button` primitive (everything else). This is a spec 0095 standardization gap.
12. **i18n by string matching.** ProcessingPanel translates two backend warnings by comparing them to hardcoded English sentences. Unknown warnings and raw job errors are shown untranslated.
13. **Repeated free-text "origin/consent" fields.** They appear in PersonFormSheet (consent), SpeakerCard (decision origin, per card), SpeakerReview legacy (origin), SelectedVoiceEnrollment (enrollment origin) and PersonVoiceSamples (revoke origin). Each uses its own input, validation and label.
14. **Raw internal identifiers in the UI**: personId, sampleId, meetingId, turnId, job id (in the version select), SHA-256 and model paths.
15. **Session metadata is half-editable.** Title is editable; status, start and end are display-only, even though `library_update_session` accepts them.

#### 4. Dead / unreachable in scope (verified with grep, non-test files)
- `buildMeetingSlashItem` (`src/features/meetings/slashCommand.ts`): not imported anywhere, so the meeting block cannot be inserted from the UI.
- `MeetingCard` (`src/features/meetings/MeetingCard.tsx`): only rendered via `MeetingBlock` (an existing note would need a `meeting` block) and by DEV-only `src/routes/DevShellPreviewRoute.tsx`.
- `src/features/meetings/fixtures.ts` (`useMeeting`, `useMeetingNotes`): used only by MeetingCard and slashCommand. `useMeetingNotes` has no consumer.
- `voiceCuration.profiles()` → `library_voice_profiles` and `voiceCuration.samples()` → `library_person_samples` (`voiceCuration.ts`): v1 wrappers, never called (the UI uses the `_page` variants).
- `src/features/sessions/calendarFixtures.ts` and `src/features/sessions/__fixtures__/sqlite-recordings.json`: test-only.
- Session Summary tab: reachable, but it is a permanent empty placeholder.
- Every other component in scope is reachable from `/meetings`, `/sessions/$id`, `/people`, `/calendar` or the rail sidebar.

##### Embedding points outside scope
- `SessionSidebar` is in `src/components/AppShell/Rail.tsx`.
- `library.*` and `sessionCaptureCache` / `sessionListCache` are used by `src/components/AppShell/RecordingStatus.tsx`.
- `library.status` is used by `src/features/detection/CallDetectionController.tsx`.
- `library` / `sessions` / `startSessionCapture` are used by `src/features/detection/directCapture.ts`.
- `library.list` and the participant context IPC are used by `src/features/agenda/AgendaView.tsx`.
- `meetingBlockSpec` is used by `src/features/notes/NoteEditor.tsx`.
- `NoteEditor` is embedded by `SessionNotes`.
- Rail links reach `/calendar`, `/meetings` and `/people`.
- `/sessions/$id` is linked from the sidebar, the calendar, RecordingStatus and `src/features/detection/MeetingReminder.tsx`.
- The `toggle-recording` route (global shortcut) only navigates to `/meetings` and does not toggle (`src/routes/__root.tsx`).

---

## 3. Domain objects: lifecycle as the user sees it (consolidated)

Detailed step tables are in §2.A.2 and §2.B.2. This is the cross-object view.

| Object | Created | Viewed | Edited | Deleted / revoked | Gaps |
|---|---|---|---|---|---|
| Note (Markdown file) | Board toolbar "New activity"/"Free text", canvas double click, empty-state button (`src/features/board/useBoardCreation.ts`); palette "New note" (`CommandPalette.tsx`); tray "New note" + shortcut `notes-new` (`__root.tsx`); "Duplicate" (`NoteEditor.tsx`); session personal note lazily (`library_ensure_personal_note`, `src/features/sessions/SessionNotes.tsx`) | `/notes/$id` (BlockNote or canvas editor), board card read view, session Notes tab (embedded), palette list, backlinks | BlockNote `NoteEditor.tsx`; canvas `src/features/board/editor/CanvasNote.tsx`; `ColoredNoteEditor.tsx`; embedded in session. Title/tags derived from Markdown, not directly editable | Note menu "Move to Trash" (`NoteActionsMenu.tsx`), palette delete (`CommandPalette.tsx:66`). Permanent (`src-tauri/src/storage/deletion.rs:30`). Session notes refuse delete | No notes list; no tag browser; daily note has no UI; no trash/undo; board card cannot open full page |
| Board item: activity card / free text / area; dependency edge | Board toolbar, double click, "Add existing note" | `/` canvas, minimap, inspector outline | Inline editor, progress (card footer or inspector), inspector fields, drag/resize/drop-into-area, layer order, edges via handles or inspector | Inspector "Remove from board" (no confirm, note survives); edge × or Delete | Board persisted in `<vault>/.coxinha/board.json`; strings outside `locales/` |
| Meeting session | Sidebar "+" (`SessionSidebar.tsx`); detection "Yes, record" (`directCapture.ts`); implicitly by `/meetings` capture/import (backend creates `origin: recording` session) | Sidebar list, `/calendar` (month/list), `/sessions/$id` | Title only (`SessionHeading.tsx`, `library_update_session`) | None | Status/start/end not editable though IPC accepts them; no delete/cancel; no create from Calendar |
| Recording (capture, tracks mic + output, or imported WAV) | `/meetings` "Start recording" (`library_start`, no session); session strip "Start recording" (`library_start_session`); detection auto-start; `/meetings` "Import local WAV" (`library_import_audio`) | `/meetings` list + detail; session strip (+ Playback toggle); RecordingStatus | Pause/Resume/Stop in 4 places; "Recover interrupted capture" | None | One recording per session; import cannot attach to an existing session; no link recording → session |
| Processing job / transcript | ProcessingPanel "Process recording" (needs hand-made JSON model config) in `/meetings` detail and session Transcript tab | Transcript segments (click to seek), job list, version select | "Separate human correction" per segment (`library_edit_segment`) | None | Summary tab is a permanent placeholder; `summarize_meeting` unused; no progress events (polling only) |
| Speaker assignment (track × diarized speaker) | Produced by processing | SpeakerReview / SpeakerCard in `/meetings` detail and session Speakers tab | Confirm/correct identity with "Decision origin" (`library_confirm_speaker`) | Revoke (`library_revoke_assignment`), legacy track-less revoke | Suggestions only when calibrated |
| Person | `/people` "Add person"; SpeakerReview "Add a person / agenda names" (both `PersonFormSheet.tsx`, `library_create_person`, consent origin required) | `/people` list (paged, client search over loaded pages), collapsed list inside every SpeakerReview | None | None | No rename, merge, delete; raw ids shown |
| Voice sample / profile | SelectedVoiceEnrollment inside a confirmed SpeakerCard (`library_enroll_selected_turns`) | PersonVoiceSamples (on `/people` and in SpeakerReview), VoiceComparisonPanel (SpeakerReview only) | None | Revoke one sample (`library_revoke_voice_sample`); bulk via revoke identity | Delete not offered (audit) |
| Participant candidate (per recording) | ParticipantContext manual form; Agenda "Add candidates to selected meeting"; detection auto (invitees) | ParticipantContext (inside PersonFormSheet in SpeakerReview) | Same form | "Remove candidate" | Three writers, one IPC (`library_set_participant_context`) |
| Calendar event (Outlook) | Connect (`calendar_begin/complete`) + Sync (`calendar_sync`), 30 days | `/agenda` list; detection invitation picker | Read-only | "Disconnect and remove cache" (`calendar_disconnect`, no confirm) | No event detail; event not linked to session; not shown on `/calendar` |
| Detected call | Backend polling (`call_detection_status`) | MeetingReminder banner | Choose invitation/title in "Meeting details" | "Ignore this call" (in memory) | No history; `call-detected` event unused |

---

## 4. Settings (`/settings`, `src/features/settings/SettingsView.tsx`)

Layout: page header "Settings" + description, left section nav (anchor links that focus each heading, `SettingsFrame.tsx`), content column. Deep link via route hash (`initialSection`). Load: `get_config` + `list_obsidian_vaults`. States: loading, load error (Retry + "Show diagnostics" → `desktop_diagnostic_info`), ready.

| # | Section (nav label) | Settings / controls | Persisted where | IPC | File |
|---|---|---|---|---|---|
| 1 | Appearance | Theme segmented control Auto / Light / Dark (+ hint) | localStorage `coxinha.themePref` | none (Linux: no native theme follow, `src/lib/nativeTheme.ts`) | `SettingsSections.tsx` `AppearanceSection` |
| 2 | Meeting detection | Checkbox "Remind me when a possible meeting starts"; description; alerts "unsupported" (non Linux PulseAudio/PipeWire) and "unavailable, retrying" | localStorage `coxinha:meeting-detection` (pushed to backend) | `set_call_detection_enabled`, `call_detection_status` (via controller) | `src/features/detection/DetectionSettings.tsx` |
| 3 | Integrations | Outlook card: status badge, account, freshness; "Advanced" client ID + tenant; "Connect Outlook" / "Cancel connection" / "Disconnect and remove cache" / "Sync now" / "Open agenda"; error + Retry | tokens/cache backend; client ID/tenant localStorage | `calendar_status`, `calendar_begin`, `calendar_complete`, `calendar_cancel`, `calendar_sync`, `calendar_disconnect` | `IntegrationsSection.tsx`, `src/features/agenda/OutlookConnectionCard.tsx` |
| 4 | Vault / storage | Current path (read-only). "Folder switching is disabled…" note. Collapsed "Other folders": detected Obsidian vaults (radio list, last opened, missing badge), custom path input, Save. All inside `fieldset disabled` and Save `disabled={true}`: visible but unusable | backend `AppConfig.vault_path` | `list_obsidian_vaults`; `update_config` wired but unreachable | `SettingsView.tsx` |
| 5 | Shortcuts | Read-only list: New note, Open app, Agenda, Meetings, Toggle recording with their chords; "Editing … later version" | backend `AppConfig.shortcuts` | `get_config` | `SettingsSections.tsx` `ShortcutsSection` |
| 6 | Rebuild note index | Description + "Rebuild" → stats alert (notes, links, skipped) or classified error (`SettingsRebuildError.tsx`); reloads notes | | `rebuild_from_vault`, `list_notes` | `SettingsView.tsx` |
| 7 | Diagnostics | "Show diagnostics" → preformatted text | | `desktop_diagnostic_info` | `SettingsView.tsx` |

Backend config with no UI at all (`AppConfig` in `shared/src/lib.rs`): `locale`, `transcriber` (engine/model/accelerator), `diarizer` (none/pyannote/speakrs + model paths + accelerator), `llm` provider (ollama/claude/open_ai/groq/open_router + model), `autostart`. Processing model configuration lives instead as a hand-pasted JSON in ProcessingPanel (`src/features/meetings/ProcessingPanel.tsx`), not in Settings.

Preferences that live outside Settings: note font/size/width (note menu), sidebar and side-panel visibility, session sidebar collapse, theme toggle duplicate in palette, Outlook client ID duplicate in Agenda (see 1.9).

---

## 5. Backend capability without UI, and UI that is dead or unreachable

### 5.1 Registered IPC commands with no reachable UI caller (13 + 1)

| Command | Backend state | Frontend reference | Note |
|---|---|---|---|
| `list_meetings`, `get_meeting` | Work (legacy `meetings` table) | typed in `bindings.ts`, never called | Superseded by `library_list` / `library_detail` |
| `start_recording`, `stop_recording` | Work (legacy `recorder`) | never called | Superseded by `library_start` / `library_stop` |
| `transcribe_meeting` | Stub, returns "not wired yet (spec 0008)" | never called | |
| `summarize_meeting` | Calls LLM summarizer | never called | Session "Summary" tab is a placeholder; no summary feature exposed |
| `get_active_calls` | Works | never called | Detection uses `call_detection_status` |
| `list_tags`, `list_notes_by_tag` | Work | never called | No tag browser; tags only shown as chips |
| `search_notes` | Works (full text) | only `store.searchNotes` (`src/lib/store.ts:98`), never called | Palette filters titles client side |
| `get_or_create_daily_note` | Works | only `store.openDailyNote` (`src/lib/store.ts:103`), never called | Daily note feature has no UI; stale `agenda.daily*` strings |
| `library_voice_profiles`, `library_person_samples` | Work (v1 unpaged) | wrapped in `voiceCuration.ts`, never called | UI uses `_page` variants |
| `update_config` (+1) | Works | called from Settings vault Save, but the button is hard-disabled | No way to change vault, locale, models, LLM, autostart, shortcuts |

Events emitted with no listener: `call-detected` (`src-tauri/src/call_detector.rs:136`, frontend polls instead), `recording-progress`, `transcription-progress` (typed in `bindings.ts`; UI polls `library_status`).

Parameters accepted but not exposed: `library_update_session` accepts status / starts_at / ends_at; UI only sends title.

Bindings staleness: `src/lib/bindings.ts` types only 22 legacy commands. All 48 `board_*`, `calendar_*`, `desktop_*`, `library_*`, `*call_detection*` commands are raw string `invoke()` calls in `src/features/meetings/library.ts`, `voiceCuration.ts`, `src/features/sessions/sessions.ts`, `sessionCapture.ts`, `src/features/agenda/calendar.ts`, `src/features/board/persistence.ts`, `src/features/detection/*`, `src/lib/*`.

### 5.2 Dead or unreachable UI

| Item | File | Why |
|---|---|---|
| `/home` route (HomeCanvas greeting, "things today" always empty, recents; HomePanel Messages/News always empty) | `src/routes/HomeRoute.tsx`, `src/features/home/*` | No link, palette entry or IPC route targets it (`navigate:home` goes to `/`) |
| `/notes` index | `src/router.tsx` | Same component as `/`; there is no notes list screen |
| Dev routes `/dev/menu-preview`, `/dev/shell-preview` | `src/routes/DevMenuPreviewRoute.tsx`, `DevShellPreviewRoute.tsx` | DEV build only, no navigation entry; render fixture MeetingCard, fake Star/Share buttons, SavedIndicator |
| `BoardNotePanel` (old side-panel card editor) | `src/features/board/BoardNotePanel.tsx` | Not imported |
| Meeting block in note editor (Summary / Transcript / Action items tabs) | `src/features/meetings/MeetingBlock.tsx`, `MeetingCard.tsx`, `fixtures.ts` | Registered in BlockNote schema (`NoteEditor.tsx:36`) but renders fixtures, and its slash item `slashCommand.ts` is never wired, so it cannot be inserted |
| Agenda fixtures, home fixture | `src/features/agenda/fixtures.ts`, `src/features/home/fixtures.ts` (`homeFixture`) | Not imported |
| Session "Summary" tab | `src/routes/SessionRoute.tsx:136` | Reachable, permanent empty state |
| Settings vault switcher | `SettingsView.tsx` | Rendered disabled |
| ChromeTabs (multi-tab strip, close, new tab) | `src/components/AppShell/ChromeTabs.tsx` | No route passes >1 tab or handlers |
| `RailSection`, `SavedIndicator`, `chromeLeft`/`chromeRight` | `src/components/AppShell/*` | Unused in prod routes |
| Note menu hints Ctrl+L, Ctrl+D; palette hints Ctrl+N, Win+Shift+A, Ctrl+, ; tray "Ctrl+Alt+N" | `NoteActionsMenu.tsx`, `CommandPalette.tsx`, `src-tauri/locales/en.yml` | Shown but not bound / wrong chord |
| Unused locale keys | `src/locales/en.json` `noteMenu.*` (archive, present, lock, AI, translate, export, version history, copied toasts), `agenda.daily*`, `home.*`, `assistant.*`, `meeting.*` | No component uses them; 70 en keys are missing in pt-BR (palette 16, sidebar 12, home 7, assistant 7, meeting 7, …) |
| Store fields `setActiveNote`, `activeNoteId` | `src/lib/store.ts` | Never used |
| "Copy link" `coxinha://notes/{id}` | `NoteActionsMenu.tsx` | No handler for that URL scheme |

---

## 6. Duplicates and inconsistencies (same capability in more than one place)

| # | Capability | Places (files) | Problem |
|---|---|---|---|
| 1 | Start recording | `/meetings` CaptureSection → `library_start` (`src/features/meetings/LibraryView.tsx`, `CaptureSection.tsx`); session strip → `library_start_session` (`src/features/sessions/SessionRecording.tsx`, `sessionCapture.ts`); detection banner → create session + `library_start_session` (`src/features/detection/directCapture.ts`); global shortcut "toggle recording" only navigates (`__root.tsx`) | Three code paths, two semantics (with / without session), device selection reimplemented in `directCapture.ts` |
| 2 | Pause / resume / stop | LibraryView, SessionRecording, RecordingStatus sidebar card and top bar (`src/components/AppShell/RecordingStatus.tsx`), MeetingReminder "Stop and save now" (`directCapture.ts`) | 5 surfaces; each has its own status state |
| 3 | Recording status polling | LibraryView 250 ms, SessionRecording 1 s, RecordingStatus 0.5/2 s, CallDetectionController 3 s | 4 independent `library_status` pollers, no shared store; backend `recording-progress` event unused |
| 4 | Recording detail (player, transcript, corrections, speakers, processing) | `/meetings` right pane "legacy" view and `/sessions/$id` Transcript + Speakers tabs (`src/features/meetings/RecordingDetail.tsx`, `ProcessingPanel.tsx`, `SpeakerReview.tsx`) | Same controls in two screens with different layouts; `/meetings` rows don't link to their session |
| 5 | Session browsing by date | Sidebar list with own period filter (`SessionSidebar.tsx`), Calendar month grid and list (`CalendarView.tsx`), plus Outlook `/agenda` (`AgendaView.tsx`) | 3 period states (`sidebarPeriod`, `calendarPeriod`), two calendar concepts ("Calendar" = sessions, "Agenda" = Outlook), Outlook events absent from Calendar; `SessionEntry` has two layouts with different status vocabularies (`SessionList.tsx`) |
| 6 | Create note | Board toolbar / double click / empty state (`useBoardCreation.ts`), palette (`CommandPalette.tsx`), tray + global shortcut (`__root.tsx`), Duplicate (`NoteEditor.tsx`) | Board ones place a card; palette/tray/shortcut create orphan notes invisible on the board, and there is no notes list to find them except the palette |
| 7 | Delete note | Note menu "Move to Trash" (`NoteActionsMenu.tsx`/`NoteEditor.tsx`), palette action + row trash + Ctrl+Backspace (`CommandPalette.tsx`); board "Remove from board" looks similar but keeps the note | "Trash" label but permanent delete; `window.confirm` dialogs; different guards |
| 8 | Note editing | BlockNote `src/features/notes/NoteEditor.tsx` vs TipTap canvas `src/features/board/editor/CanvasNote.tsx` (+ `ColoredNoteEditor.tsx` on `/notes/$id` when colors exist) vs embedded BlockNote in session (`SessionNotes.tsx`) | Different features (attachments, slash menu, backlinks, menu only in BlockNote; colors only in canvas); different debounce (500/400 ms); standalone BlockNote not localized |
| 9 | Outlook connection | `/agenda` (`AgendaView.tsx`, own Sync/Configure buttons) and Settings > Integrations (`IntegrationsSection.tsx`), same `OutlookConnectionCard.tsx`; `calendar_status` read separately by Agenda, Settings and detection `MeetingDetails.tsx` | Duplicated sync/freshness/error UI; no shared cache |
| 10 | Create person / list people | `/people` (`PeopleDirectory.tsx`) and SpeakerReview "Add a person" (`SpeakerReview.tsx`), both `PersonFormSheet.tsx`; `VoiceProfilesPanel.tsx` standalone on `/people` and collapsed in every SpeakerReview | Same registry shown in two contexts with different capabilities (search only standalone) |
| 11 | Participant candidates | ParticipantContext form (`ParticipantContext.tsx`), Agenda "Review invitees" (`AgendaView.tsx`), detection auto (`directCapture.ts`) | Three writers to `library_set_participant_context`, no conflict UI |
| 12 | Theme | Settings Appearance (3-way incl. Auto) and palette "Toggle theme" (2-way, drops Auto) | Inconsistent options |
| 13 | Navigate to `/` | Rail "Activities", brand logo (sidebar), logo in chrome cap when collapsed, shortcut `open_app` | Labels disagree: "Activities", "Activity map", "Activity board" (tab), "Board" (`nav.notes`) |
| 14 | Name of the recordings area | Rail "Recordings", page "Meeting library", AppError "Meetings", RecordingStatus "Open meeting library", session strip "Open capture and import", "Open meeting" = session | One concept, five names; "meeting" means session in some places and recording in others; a third "meeting" model lives in `MeetingCard`/`fixtures.ts` |
| 15 | Open a note's editor from board | Card double click, pencil, Enter, inspector "Open" | Four ways to inline edit, zero ways to open the full page |
| 16 | Board layer and progress controls | On node when selected and in inspector (`BoardNodes.tsx`, `BoardFields.tsx`) | Duplicated controls |
| 17 | "Origin/consent" justification fields | `PersonFormSheet.tsx`, `SpeakerCard.tsx`, `SpeakerReview.tsx` (legacy), `SelectedVoiceEnrollment.tsx`, `PersonVoiceSamples.tsx` | Five free-text fields with separate validation and labels |
| 18 | Keyboard hint text | Palette (`CommandPalette.tsx`), note menu (`NoteActionsMenu.tsx`, `NoteEditorFrame.tsx` shows `⌘.` everywhere), tray (`en.yml`), Settings Shortcuts | Four sources disagree with the real bindings |
| 19 | Diagnostics display | Settings Diagnostics section, Settings load-error state, `AppError` page | Same `desktop_diagnostic_info` dump in three places |
| 20 | UI primitives | Raw `<button>` (SpeakerCard, SpeakerReview, VoiceComparisonPanel, SelectedVoiceEnrollment, SessionSidebar, DesktopRecoveryDialog, `__root.tsx` startup alert, AppError) vs `src/components/ui/Button` | Spec 0095 standardization incomplete; three time formatters (`ProcessingPanel.tsx`, `SpeakerCard.tsx`, `voiceControls.tsx`, `RecordingInformation.tsx`) |

---

## Appendix A. IPC command → UI callers (57 used)

| Group | Command | Called from |
|---|---|---|
| Notes | `list_notes` | `src/lib/store.ts` (boot in `__root.tsx`, after rebuild) |
| | `get_note` | `NoteDetailRoute.tsx` loader, `CanvasNote.tsx`/`CanvasTextEditor.tsx`, `SessionNotes.tsx`, Duplicate |
| | `create_note` | store `newNote` (board, palette, tray/shortcut), Duplicate |
| | `update_note` | note save queue (BlockNote, canvas, embedded), board checklist toggle |
| | `delete_note` | note menu, palette |
| | `get_backlinks` | `BacklinksPanel.tsx` |
| | `save_attachment` | `NoteEditor.tsx` upload/paste |
| | `rebuild_from_vault`, `get_config`, `list_obsidian_vaults`, (`update_config` disabled) | `SettingsView.tsx` |
| Board | `board_load`, `board_save`, `board_export_recovery` | `src/features/board/persistence.ts`, `ActivityBoard.tsx` |
| Calendar | `calendar_status`, `calendar_begin`, `calendar_complete`, `calendar_cancel`, `calendar_sync`, `calendar_disconnect` | `src/features/agenda/calendar.ts` via `useOutlookConnection.ts` (Agenda, Settings), `MeetingDetails.tsx` (status) |
| Detection | `set_call_detection_enabled`, `call_detection_status` | `CallDetectionController.tsx`, `meetingDetection.ts` |
| Desktop | `desktop_diagnostic`, `desktop_diagnostic_info`, `desktop_flush_started`, `desktop_flush_result`, `desktop_recovery_response` | `DesktopLifecycle.tsx`, `lifecycle.ts`, `AppError.tsx`, `SettingsView.tsx` |
| Capture | `library_sources`, `library_start`, `library_start_session`, `library_pause`, `library_stop`, `library_status`, `library_recover`, `library_import_audio` | `LibraryView.tsx`, `SessionRecording.tsx`, `RecordingStatus.tsx`, `directCapture.ts`, `CallDetectionController.tsx`, `RecordingDetail.tsx` |
| Recordings | `library_list`, `library_detail` | `LibraryView.tsx`, `SessionRecording.tsx`, `AgendaView.tsx` (list) |
| Sessions | `library_sessions`, `library_session`, `library_create_session`, `library_update_session`, `library_ensure_personal_note` | `sessions.ts` (sidebar, calendar, SessionRoute, SessionHeading, SessionNotes), `directCapture.ts` |
| Processing | `library_process`, `library_processing`, `library_edit_segment` | `ProcessingPanel.tsx`, `useProcessing.ts` |
| Speakers/people | `library_recognition`, `library_confirm_speaker`, `library_revoke_assignment`, `library_create_person`, `library_participant_context`, `library_set_participant_context` | `SpeakerReview.tsx`, `SpeakerCard.tsx`, `PersonFormSheet.tsx`, `ParticipantContext.tsx`, `AgendaView.tsx`, `directCapture.ts` |
| Voices | `library_enrollment_candidates`, `library_enroll_selected_turns`, `library_voice_profiles_page`, `library_person_samples_page`, `library_revoke_voice_sample`, `library_voice_comparison` | `SelectedVoiceEnrollment.tsx`, `VoiceProfilesPanel.tsx`, `PersonVoiceSamples.tsx`, `VoiceComparisonPanel.tsx` |
