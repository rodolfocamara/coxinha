# UI audit — Coxinha current state and direction

- **Date:** 2026-04-20
- **Author:** Claude Code (under direction from the owner)
- **Status:** Research artifact, not a spec
- **Companion:** `screenshots/README.md` (produced by a parallel
  background agent — screenshots at three viewports across five
  routes)

## Scope

This document captures the client-side UI as of the commit on
`main` when it was written, calls out gaps the current shape
makes painful, and sketches a direction. The actionable decisions
land in spec 0042; this artifact is upstream evidence, not
prescription.

Three specific complaints from the project owner motivated the
audit:

1. `Ctrl+Alt+N` never reaches Coxinha on Windows. Confirmed —
   known conflict with OneNote / Office 365.
2. The empty state feels like "a container where you have to
   type" — it reads as a gated form rather than an inviting
   surface.
3. The app uses very few components by design (good for perf /
   boot / bundle) but the UI is beginning to lag behind the
   product ambition. Balance question.

## Current state — reading the source

### Tokens (`src/index.css`)

The project uses the shadcn token contract: every colour is an
HSL triplet fronted by a CSS custom property, aliased inside
`@theme { --color-*: hsl(var(--*)) }` so Tailwind utilities read
the same values. Two modes (`:root`, `.dark`) toggled via a class
on `<html>`.

What is defined:

- Brand colour: `primary = 28 69% 55%` (Coxinha orange, ~#de8c3a).
  Identical across light and dark; only the surfaces flip.
- Full surface palette: `background`, `foreground`, `card`,
  `popover`, `muted`, `accent`, `destructive`, plus matching
  foregrounds.
- `--ring` aliased to primary — focus outline is brand-coloured.
- Radius scale: `lg = 0.5rem`, `md = lg - 2px`, `sm = lg - 4px`.
- Font family: Inter + JetBrains Mono.
- `prefers-reduced-motion` honoured globally.

What is **not** defined but should be, before the UI grows:

- **Typography scale.** Only family; no `--text-xs`/`-sm`/`-base`
  triplet with line-height. Tailwind defaults are in effect but
  we don't own them.
- **Shadow tokens.** No `--shadow-sm`/`-md`/`-lg`. Popovers,
  dialogs, toasts will have to inline their shadow or land on
  Tailwind defaults that don't track theme.
- **Z-index scale.** Same story. Dialog / toast / dropdown will
  collide on z-index unless we pick an order now.
- **Animation tokens.** No `--duration-*` / `--ease-*`. Fine
  while animations are absent; becomes debt the moment we add
  shadcn primitives.

### Components

| Component | Lines | Role | Notes |
|---|---|---|---|
| `Sidebar.tsx` | 282 | Notes list + search + tag filter + nav | substantial; good a11y |
| `NoteEditor.tsx` | 232 | BlockNote host, Suspense, save debounce | hand-rolled promise cache (to be replaced per ADR-0016) |
| `BacklinksPanel.tsx` | — | Shown beside the editor | |
| `AgendaView.tsx` | — | Daily-notes view | |
| `SettingsView.tsx` | — | Settings panel | |
| `App.tsx` | 128 | Shell + fake router + event wiring | pseudo-router (ADR-0016 replaces) |

No shared primitive layer (`Dialog`, `Popover`, `DropdownMenu`,
`Toast`, `Command`). `@blocknote/shadcn` brings shadcn-style
classes into the editor but nothing outside it consumes that
vocabulary.

### Empty states

- `App.tsx :: EmptyState` — centered `<p>` + `<button>` ("New
  note"). Uses `text-muted-foreground`. Vertically centered.
  Reads as a form gate, not an invitation.
- Sidebar empty (no notes yet) — i18n string `sidebar.emptyState`
  rendered as a muted `<p>`.
- Agenda / Meetings / Settings — their own views, none of which
  have been screenshotted in motion yet; see `screenshots/`.

The editor never shows before the user clicks the CTA. This is
the "container to type in" feeling the owner called out.

### Global shortcuts

Configured in `shared::ShortcutsConfig`, registered in
`src-tauri/src/shortcuts.rs`. Five defaults per the architecture
overview:

| Key | Route |
|---|---|
| `Ctrl+Alt+N` | notes-new |
| `Ctrl+Alt+C` | home (show window) |
| `Ctrl+Alt+A` | agenda |
| `Ctrl+Alt+M` | meetings |
| `Ctrl+Alt+R` | toggle-recording |

`Ctrl+Alt+N` is confirmed conflicting on Windows with OneNote
and — depending on the user's setup — other Office 365 hotkeys.
The complaint is real and not resolvable inside the app; the
OS-level registration loses the race.

### Accessibility surface

Strong for a pre-1.0:

- `aria-label`, `aria-current`, `aria-pressed`, `aria-live`,
  `sr-only` used where appropriate.
- `focus-visible:outline` on every interactive element; ring
  colour goes through the theme token.
- `prefers-reduced-motion` honoured globally in base CSS.
- Headings are not over-competed: sidebar brand is a `<span>`
  with `aria-label`, the editor owns the `<h1>`.

Gaps are non-systemic — no rule enforcing focus order across
views, no keyboard-shortcut affordances surface (there's no
`/help` modal), no landmark audit. Fine for F1; track for F2.

### Bundle and perf balance

The thinness is deliberate: Zustand, BlockNote, Lucide, clsx,
Tailwind, i18next. No radix, no shadcn components, no
framer-motion, no React Query (yet — ADR-0016 will add it).
Pays off:

- Boot 1.44 s measured (spec 0003).
- New-note 2 s total budget comfortably met.
- No dependency on a design-system megabundle.

The cost is visible now:

- Modals fall back to raw HTML or are absent.
- No command palette — power users have nowhere to put fast
  navigation.
- No toast surface — save failures, background errors,
  async completions have no place to land.
- Workspace switcher (spec 0041) and Share modal (spec 0040)
  will each need a primitive to exist first.

## Findings from the screenshot capture

A background agent captured 15 screenshots (5 routes × 3 viewports)
after this audit's source-reading pass. Raw results and console
logs are in `screenshots/README.md`. Points the screenshots surface
that code-reading alone did not:

- **No max-width or content-widening on large viewports.** At
  1920×1080 every route shows the main content hugging the left
  edge of the pane, with a large band of empty space on the right.
  Sidebar stays a fixed ~280 px regardless of viewport width.
  The app currently has no opinion about "reading width" — which
  is acceptable for F1, but is a decision that needs to be made
  once the editor lands on truly wide monitors.
- **Meetings and Settings are placeholders.** Both routes render
  their shell plus a "Coming soon" copy block. That is expected
  and tracked elsewhere (meeting pipeline spec 0008, settings
  spec 0010), but it means the screenshot set under-represents
  what those screens will look like once they ship.
- **Agenda renders an inline error banner in browser mode** —
  the `invoke` failure surfaces in a red banner inside a normal
  page layout rather than crashing the route. Good defensive
  behaviour; worth preserving.
- **The orange "New note (Ctrl+Alt+N)" CTA** is exactly what the
  empty-state complaint described: a button floating in an empty
  pane, reading more as a form gate than as an invitation to
  type. Visual confirmation of the code-read.
- **Sidebar fixed width holds up across viewports.** Works
  visually at 1024 px and 1440 px; at 1920 px the narrow sidebar
  plus no content max-width produces the "isolated island" effect
  mentioned in the first bullet.

None of the screenshots revealed a visual regression, a broken
route, or a contrast/focus issue that the source-reading pass
missed. Console errors are entirely the expected
`window.__TAURI__ is undefined` cascade from running in a plain
browser; no unexpected runtime errors.

## Gaps that a polish pass must address

1. **Hotkey broken on Windows.** The primary entry point never
   fires. Any shortcut redesign touches `shared::ShortcutsConfig`
   defaults and updates the architecture overview.
2. **Empty state gates the editor.** A tap-first flow is the
   opposite of what the product wants — the value proposition is
   "press a key, start typing."
3. **Primitive layer missing.** Every upcoming feature (share
   modal, workspace switcher, tag dropdown, command palette,
   toast for save errors) needs a primitive that does not yet
   exist.
4. **Tokens are half-finished.** Typography + shadow + z-index
   need to ship before the primitive layer lands so the primitives
   don't invent their own.
5. **Brand chrome is thin.** The only visible identity is a
   label in the sidebar corner. Acceptable, but we should pick
   whether that is intentional (ASCII-aesthetic) or pending.
6. **No content width strategy on wide viewports.** Screenshots
   at 1920×1080 show content hugging the left with large empty
   bands on the right. A `max-width` on the main column (a la
   Bear / iA Writer / Craft) would restore visual centring on
   wide screens. Not in spec 0042 scope — flagged for a future
   small polish pass when the editor lands in front of the owner
   on a wide monitor and the decision matures.

## Direction

Spec 0042 covers the polish pass. Shape:

- **Shortcut change**: add a third modifier so the chord avoids
  every common default on Windows. Recommendation:
  `Ctrl+Alt+Shift+N` for new note; same shift added to the
  other four shortcuts. (`Win+Shift+N` considered and rejected —
  intrusive feel, some distros/WMs use it.)
- **Empty state redesign**: route `/` renders the editor
  directly on an in-memory draft. First keystroke persists the
  draft via `create_note` and swaps the URL to `/notes/<id>`
  silently. Blur on empty discards the draft — no file, no row.
  Matches Bear's "type here" model.
- **Primitive cherry-pick**: shadcn CLI brings `Dialog`,
  `DropdownMenu`, `Popover`, `Toast` (Sonner), and `Command`
  into `src/components/ui/`. Files are copied, not bundled —
  perf cost is only what we actually import. Token contract is
  already compatible.
- **Typography + shadow + z-index tokens**: add to `@theme { ... }`
  block before primitives land.

What stays out of scope for the polish pass:

- Visual refresh of the Sidebar (that is ADR-0016's
  `features/` restructure territory — spec 0039).
- Workspace switcher UI (spec 0041).
- Share modal UI (spec 0040).
- Animation library. Sonner provides its own; other animations
  remain CSS transitions gated by reduced-motion.

## Related research

- `docs/research/type-model-benchmark.md` — product-taxonomy
  research that informed ADR-0017. The UI audit here sits
  alongside it; neither depends on the other.
- `docs/research/ui-audit/screenshots/` — visual capture at
  three viewports, produced by a parallel background agent.
  Console errors captured in its `README.md` for context.

## Follow-ups

- Spec 0042 — UX polish (this audit's actionable output).
- `docs/architecture/conventions.md` — append a short section
  listing the primitive surface we choose so future features
  don't invent their own.
- `docs/architecture/overview.md` — the global-shortcuts table
  inside it updates when spec 0042 ships.
