# 0057 — App shell rebuild: three-column layout, Home landing, meeting-as-block

> Emenda 2026-10-17: ADR-0018 e spec 0058 prevalecem no domínio de reuniões.
> Linux+Windows, biblioteca independente de notas, trilhas originais separadas,
> core sem Tauri, bancos canônicos separados e identidade apenas confirmada.
> Regras anteriores conflitantes permanecem abaixo como histórico, sem vigência.


**Status:** draft
**Supersedes part of:** [0052 Mix B Refined shell](./0052-mix-b-refined-shell.md)
**Depends on / references:** [0006 App shell](./0006-app-shell.md), [0043 Command palette](./0043-command-palette.md), [0008 Meeting pipeline](./0008-meeting-pipeline.md), [0015 Vault import](./0015-vault-import.md)

## Why

The Mix B Refined shell (spec 0052) wrapped the app in a 48 px rail + 52 px ChromeBar + canvas. It was the right baseline for PR #22 but does not reach the surface area the product needs: a Home landing that shows "what matters today", a meeting canvas with Summary / Transcript / Action items, and a right-hand context panel (sources, messages, eventually an AI chat). The reference designs in `docs/ui/new-options.pen` (Pages 26/27/28 — dark + light) and the Notion screenshot the user anchored on during brainstorming all point to the same shape: a three-column workspace shell (rail → canvas → side panel), a top chrome bar with tabs, and richer canvases per route.

This spec captures the target shell, the data model it implies, and the ordered plan to get there.

## Non-goals

- No Tauri IPC is changed in this pass. Notes still persist via the existing `save_note` / `get_note` / `new_note` commands.
- No new integrations (Google Calendar, e-mail, Anthropic API). AI agent chat (Page 28, Sofia) is explicitly **out of scope** and will live in its own later spec.
- No live backend for meetings. Meetings render from in-memory fixtures in this pass; the database migration follows in a later spec.
- The command palette, global shortcuts registration, and note editor persistence model stay as they are. Only the remap of `Ctrl+Alt+Y` → `Ctrl+Alt+H` lands here.

## Invariant check

| Invariant (CLAUDE.md) | Impact |
|---|---|
| Filesystem is canonical | **Diverges in design.** The feedback memory `feedback_db_first_not_vault_first.md` records the user's repeated correction: SQLite is canonical, vault is an import surface only. This spec **designs toward DB-first**; actual DB-backed storage lands in a later spec with an ADR that formally updates the invariant. No storage code changes in this pass. |
| Windows-first | Validated on Windows with Playwright evidence captures. |
| Zero network in F1 | Respected. No network calls added. |
| Tray-resident | Unaffected; shell is purely UI. |
| Plain Markdown | `MeetingBlock` serializes as `<!-- meeting:<id> -->` marker. Any external Markdown editor still opens the note; the block degrades to an HTML comment with the meeting id in place. |
| i18n + a11y from day one | Every new string is keyed; every new interactive element has a role + label. |
| Specs ship with tests | Component tests cover every new primitive; `DevShellPreviewRoute` + Playwright cover visual regression. |

## Target shape

### Three-column `AppShell`

```
┌───────────────────────────────────────────────────────────────────┐
│ ChromeCap   sidebar-toggle · back/forward · tabs · breadcrumb ·   │ 48 px
│                            saved · share · link · fav · more · » │
├────────────┬───────────────────────────────────┬──────────────────┤
│  Rail      │           Canvas                  │   SidePanel      │
│  256 px    │           flex-1                  │   380 px         │
│            │                                   │   (collapsible)  │
└────────────┴───────────────────────────────────┴──────────────────┘
```

Breakpoints:
- `≥ 1400 px`: all three visible.
- `1100 – 1399 px`: side panel collapses into a drawer (toggle in chrome).
- `< 1100 px`: rail also collapses into a drawer (hamburger in chrome).

Canvas and side panel are slots. Each route decides what goes in them.

```tsx
<AppShell
  trail={['home']}
  tabs={[{ id: 'home', label: 'Home', active: true }]}
  chromeRight={<SavedIndicator />}
  sidePanel={<HomePanel />}
>
  <HomeCanvas />
</AppShell>
```

### Rail (256 px)

- **Line 1:** workspace badge + workspace name (placeholder "Coxinha" until workspaces ship).
- **Line 2:** 4 quick-action icons — messages, calendar, inbox, search. (Entry points; navigation icons live below.)
- **Section "AI meeting notes":** notes whose body contains at least one `MeetingBlock`. In fixtures: hardcoded list. Later: derived from the DB.
- **Section "Recents":** recent notes by `updated_at`.
- **Footer:** status tray (minimized).

Active item highlighted via `useMatchRoute`; `aria-current="page"` when matched.

### Canvas (center)

Width is each canvas's own concern. Default for Home/Note: `max-w-[760px] mx-auto px-24`. "Full width" toggle in `NoteActionsMenu` still flips `max-w-none`.

### SidePanel (380 px)

Slot-based. Canvases that pass `null` simply hide it. Per-canvas content:
- **Home** → `HomePanel`: messages / updates.
- **Note** → `NotePanel`: related sources / related notes.
- **Agenda** → `AgendaPanel`: next events.
- **Notes index** → `null`.
- **Settings** → `null`.

State persisted in `localStorage` under `coxinha:side-panel`. Shortcut `Ctrl+\` toggles. Respects input/editor focus guard (shared with existing `isInteractiveClickTarget`).

## Routes

```
/                → HomeRoute                (new landing — was redirect to /notes)
/notes           → NotesIndexRoute          (empty-state editor, unchanged logic, new shell)
/notes/$noteId   → NoteDetailRoute          (BlockNote + MeetingBlock registered)
/agenda          → AgendaRoute              (AgendaView, new AgendaPanel)
/settings        → SettingsRoute            (SettingsView, no side panel)
  dev-only
/dev/shell-preview → DevShellPreviewRoute   (every canvas, every theme)
/dev/menu-preview  → DevMenuPreviewRoute    (retained from prior work)
```

`/meetings` and `/meetings/$meetingId` are **removed**. Meetings no longer exist as a route; they are blocks inside notes.

## Meeting as block

A meeting is not a variant of a note and not a separate route. It is a **custom BlockNote block** inserted into any note.

- `MeetingBlock` schema: `{ type: 'meeting', props: { meetingId: string } }`.
- `MeetingCard` renders the block: a card with a header (title, date, duration, participants) and a tab group (Summary / Transcript / Action items).
- Data comes from `useMeeting(meetingId)`. In this pass: `fixtures.find(m => m.id === meetingId)`. Later pass: `SELECT * FROM meetings WHERE id = ?`.
- Editing tab content writes to the meeting row, not to the note body. Two notes referencing the same meeting see the same content.
- Markdown serialization: `<!-- meeting:<id> -->`. Plain-Markdown invariant preserved; external editors show an opaque comment but do not corrupt the file.

### Linking flows

**Note → meeting:**
1. User types `/meeting` in the editor (slash command).
2. Picker appears: `[Create new meeting]` or `[Link existing…]`.
3. Create new → generate fresh `MeetingRow` (fixture in-memory this pass), insert `MeetingBlock` with that id.
4. Link existing → picker over fixtures, insert `MeetingBlock`.

**Agenda → meeting + note:**
1. Agenda view, `[+ New meeting]`.
2. Inline form: title, date, duration, participants.
3. Save meeting row; modal asks "Create a linked note?".
4. Yes → `newNote()` + insert `MeetingBlock` pointing at the new row.
5. No → meeting exists; can be linked later from any note via the note → meeting flow.

## Data shapes

```ts
export type MeetingRow = {
  id: string;
  title: string;
  startsAt: string;           // ISO 8601
  durationMin: number;
  participants: string[];
  summaryMd: string;
  transcriptMd: string;
  actionItemsMd: string;
  recordingPath: string | null;
};

export type HomeFixture = {
  userFirstName: string;
  todayDateIso: string;
  thingsToday: ThingCard[];
  recents: RecentItem[];
  messages: MessageItem[];
  news: NewsItem[];
};

export type ThingCard = {
  id: string;
  kind: 'meeting' | 'email' | 'agent-output';
  title: string;
  subtitle: string;
  href: string;
  accent?: boolean;
};

export type RecentItem  = { id: string; title: string; tag: string; updatedAtLabel: string; href: string };
export type MessageItem = { id: string; fromName: string; subject: string; excerpt: string; href: string };
export type NewsItem    = { id: string; label: string; highlighted?: boolean };

export type AgendaEvent = {
  id: string;
  title: string;
  startsAt: string;
  durationMin: number;
  participants: string[];
  meetingId?: string;
  linkedNoteId?: string;
};
```

Fixtures export `__isFixture = true`. Hooks log `console.debug('[fixture] …')` in dev so fake data is traceable in any log.

## Design tokens

### Dark mode retune (Pen / Notion-style)

Current tokens (Mix B Refined locked): `--bg-canvas` L = 0.170 (~#2A2A2A warm zinc). Target: L ≈ 0.058 (~#0A0A0A). Border shifts from `fg-primary / 0.08` to an explicit `#1F1F1F`-analog. Applies to every route because tokens flow through Tailwind 4 `@theme`.

| token | current | target |
|---|---|---|
| `--bg-canvas` (dark) | `0.170 0.003 60` | `0.058 0.003 60` |
| `--bg-surface` (dark) | `0.205 0.003 60` | `0.11 0.003 60` |
| `--bg-surface-2` (dark) | `0.245 0.003 60` | `0.16 0.003 60` |
| `--bg-sunken` (dark) | `0.145 0.003 60` | `0.035 0.003 60` |
| `--color-border` (dark) | `fg-primary / 0.08` | explicit `0.22 0.003 60` |

Light mode tokens are unchanged.

### New shell CSS vars

```
--shell-rail-width: 256px;
--shell-chrome-height: 48px;
--shell-panel-width: 380px;
```

### Fonts + accent

Unchanged. Geist sans, JetBrains Mono, Newsreader serif option. Tangerine `#DE8C3A` remains `--accent` / `--color-primary`.

## Shortcuts remap

| key | current | new |
|---|---|---|
| `Ctrl+Alt+Y` | `/notes` | removed |
| `Ctrl+Alt+H` | — | `/` (Home) |
| `Ctrl+Alt+O` | `/agenda` | `/agenda` |
| `Ctrl+Alt+G` | `/meetings` | **reserved** (agents slot) |
| `Ctrl+Alt+T` | `/settings` | `/settings` |
| `Ctrl+Alt+W` | palette | palette |
| `Ctrl+\\` | — | toggle side panel |

`shortcut_smoke.rs` updated to assert the new four-of-five registration.

## Error handling

| scenario | behavior |
|---|---|
| `MeetingBlock` with unknown `meetingId` | Card renders "Meeting not found" + `[Unlink]` button. Not silent. |
| Fixture empty (`recents: []`) | Canvas shows the designed empty state. Layout intact. |
| `/notes/<missing>` | Existing router error boundary — unchanged. |
| Side panel `open: true` persisted while in collapsed breakpoint | Visual collapses; state preserved for the next expand. |
| `Ctrl+\\` pressed inside an input/editor | No-op (reuses `isInteractiveClickTarget`). |

## i18n

New keys (`en.json`; PT mirror in `pt.json`):

```
home.greeting.morning / afternoon / evening
home.thingsToday.title / empty
home.recents.title / continue

chrome.tab.new · chrome.back · chrome.forward · chrome.saved

rail.sections.aiMeetingNotes
rail.sections.recents
rail.newMeetingNote
rail.viewAll

sidePanel.toggle
sidePanel.sources.title
sidePanel.messages.title
sidePanel.news.title

meeting.card.tabs.summary / transcript / actionItems
meeting.block.placeholder
meeting.block.notFound
meeting.block.unlink
```

## A11y

- `Rail` is `<nav aria-label="Primary">`; items are `<a>` (tanstack-router `Link`) with `aria-current="page"`.
- `ChromeTabs` uses `role="tablist"` + `role="tab"` + `aria-selected`.
- `SidePanel` is `<aside aria-label="Context panel">`; toggle is `<button aria-expanded={open} aria-controls="side-panel">`.
- `MeetingCard` tabs use `role="tablist"` + `aria-controls` for each tab panel.
- Skip-link at the top of `AppShell` targeting the canvas.
- Focus ring visible via `--color-ring` token.

## Testing

- **Vitest + RTL:** every new component (AppShell, ChromeCap, ChromeTabs, Breadcrumb, Rail, RailSection, RailItem, SidePanel, HomeCanvas, HomePanel, MeetingBlock, MeetingCard, AgendaPanel, NotePanel) has a component test. Slash command `/meeting` has behavior tests.
- **Visual preview:** `/dev/shell-preview` renders each canvas × theme × panel-state for Playwright capture.
- **Playwright evidence:** screenshots stored under `docs/research/ui-audit/evidence/2026-04-22-new-shell/`.
- **Rust:** `shortcut_smoke.rs` updated for the new 4-shortcut registration; no new Rust tests.

## Commit sequence

1. `chore(tokens+shortcuts)`: dark token retune, `--shell-*` CSS vars, shortcut remap (`Y`→`H`, free `G`), this ADR, memory update. No visible UI shift on existing routes yet (they do not use new vars).
2. `feat(shell)`: AppShell primitives + `DevShellPreviewRoute`. Lives in parallel; no route migrated yet.
3. `refactor(routes)`: `__root.tsx` renders AppShell; each route strips its `RouteLayout`; `ChromeBar`, `RouteLayout`, `MeetingsRoute`, `MeetingsView` deleted. `/meetings` removed from router.
4. `feat(home)`: HomeRoute + HomeCanvas + HomePanel + fixtures; `/` stops redirecting and lands on Home.
5. `feat(meetings)`: MeetingBlock custom block + MeetingCard + slash command + meeting fixtures; rail section "AI meeting notes" wired.
6. `feat(agenda)`: Agenda "link note" flow + AgendaPanel; PT locale mirror; accessibility sweep; Playwright evidence.

Each commit runs `pnpm lint && pnpm typecheck && pnpm test` green before pushing.

## Risks

- **Dark token retune reverberates** through every existing route. Mitigation: commit #1 lands isolated so regressions surface on their own; Playwright captures snapshots of every route before and after.
- **BlockNote custom block API surface.** Mitigation: ship `MeetingBlock` behind a minimal shape first (id-only; no inline editing of summary in this pass); inline editing can follow.
- **`MeetingBlock` serializes as an HTML comment.** Round-tripping an external editor's edits inside a note is fine for normal prose; if someone deletes the `<!-- meeting:id -->` marker in an external editor, the block disappears. Documented as expected behavior for this pass.
- **Memory lock update.** `project_mix_b_refined_locked.md` will be revised to reflect the new rail width (256 px), new chrome height (48 px), new shortcut set, and retuned dark tokens. The old values become historical.
