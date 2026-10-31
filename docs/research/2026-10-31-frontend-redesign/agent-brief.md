# Brief for spec 0096 area agents

You rebuild one area of the Coxinha frontend (Tauri 2 + React 19 + TanStack
Router + Tailwind v4 + zustand + react-query + vitest). The shell, the
recorder and the motion foundation are already done in your worktree. Work
only in your own worktree. Do not commit, push or open PRs. Leave changes
uncommitted.

## Read first

1. `docs/specs/0096-frontend-redesign.md`: the spec. Your phase has
   acceptance items; meet them.
2. `docs/research/2026-10-31-frontend-redesign/prototype.html`: the approved
   prototype (plain HTML/CSS/JS). Your view is a `<section class="view"
   id="v-...">` plus its JS render functions. Match layout, hierarchy, copy
   tone and motion. It is a design reference, not code to paste: rebuild it
   with React, the existing tokens and primitives.
3. `docs/research/2026-10-31-frontend-redesign/inventory.md`: every current
   feature and action. Everything your area owned before must stay reachable
   (same IPC, same safety rules), only presented the new way.
4. `CLAUDE.md` (invariants: filesystem canonical, i18n for every string, a11y
   keyboard reachable, specs ship with tests, ~400 lines per file then split).

## Foundation you must use

- Shell: `src/components/Shell/{Shell,NavRail}.tsx`, `shell.css`. The root
  layout renders the strip + rail once; your route renders only its content
  inside `<main data-shell-view>` (full height, `overflow` is yours).
  `AppShell` is now a pass-through; new code should not use it.
- Tokens (`src/index.css`): `bg-background`, `bg-card`, `bg-secondary`,
  `text-muted-foreground`, `border-border`, `text-primary`, plus status
  colours `text-live bg-live-soft`, `text-warning bg-warning-soft`,
  `text-success bg-success-soft`, `text-info bg-info-soft`, person hues
  `--p1..--p4` with `--p1-bg..` (use `oklch(var(--p2))`). `.cx-glass` for
  translucent panels over the ambient gradient. Motion tokens `--m-instant
  80ms`, `--m-fast 140ms`, `--m-med 200ms`, `--m-zoom 380ms`, `--e-out`,
  `--e-spring`.
- Primitives (`src/components/ui`): `Button` (variants primary, secondary,
  ghost, danger; sizes xs 26px, sm 32px, md 36px; `icon`, `iconOnly`),
  `ButtonLink`, `Field`, `Input`, `Textarea`, `Card*`, `Alert`, `EmptyState`,
  `Badge`, `Sheet`, `Select`. No action as underlined text: actions and
  navigation are buttons; text links only inside prose.
- Feature CSS goes in a file that starts with
  `@layer theme, base, components, utilities;` and wraps rules in
  `@layer components { ... }` (guarded by `layering.test.ts`). Prefer
  Tailwind utilities.
- Capture (read-only for you): `src/features/capture/captureStore.ts`
  (`useIsLive(session)`, `useCaptureStore`, `capturePhase`), `LiveBadge`,
  `captureActions.ts` (`startCapture({ sessionId, title })` is the only
  allowed way to start a capture from a screen; never call `library.start`,
  `library_start_session`, `library.pause/stop/status` yourself). Never show
  REC from `capture_state`; use `useIsLive` / `LiveBadge`.
- Motion (`src/lib/motion.ts`, `src/styles/motion.css`):
  - `prepareRouteTransition(kind)` returns the value for TanStack's
    `navigate({ to, viewTransition })`. Kinds: `nav`, `zoom`, `zoomout`,
    `local`.
  - `runTransition('local', () => update())` for in-place changes (wrap the
    state update; use `flushSync` from react-dom inside if React would batch
    it after the callback returns).
  - `nameForTransition(element, name)` gives a temporary
    `view-transition-name` that is cleared when the transition ends.
  - `setZoomOrigin(element)` before a `zoom`.
  - Shared names (contract between areas): `ws-canvas` (Hoje workspace
    preview element and the Workspace canvas), `card-<boardItemId>` (each
    preview card in Hoje and each card on the Workspace canvas), CSS class
    `view-transition-class: card` on those cards, `ws-drawer`, `ws-editor`
    (Workspace drawer and side editor), `m-title` (meeting title morph:
    source row title and the meeting detail heading).
  - Rules: only transform/opacity animate; the new state renders at once;
    respect reduced motion (the helpers already do).
- i18n: put every new string in `src/locales/areas/<area>.en.json` and
  `<area>.pt-BR.json`, each with ONE top-level key named after your area
  (merged automatically by `src/lib/i18n.ts`). Do not edit
  `src/locales/en.json` / `pt-BR.json` except to delete keys only your area
  used. Portuguese is the primary language: write natural pt-BR copy with
  correct accents, short and concrete like the prototype.
- Routes: `src/router.tsx` already points your paths at your entry
  component. Do not edit `router.tsx` unless your brief says which block.

## Visual check (required)

A browser harness mocks the Tauri IPC with fixtures:

```
pnpm dev --port <your port> --strictPort   # run in background
COXINHA_URL=http://localhost:<port> node tools/ui-preview/shoot.mjs \
  --route /your/route --name <area>-<state> --theme dark|light \
  [--state capture=recording|paused|processing|error,call=1] \
  [--click "css selector|another"] [--wait 800] --out /tmp/cx-ui
```

Base fixtures are in `tools/ui-preview/fixtures/base.js`. Add what your area
needs in `tools/ui-preview/fixtures/<area>.js` (same pattern: assign
`window.__cxFixtures.<command> = (args, state) => value`). The script prints
unmocked commands and page errors. Look at your screenshots (Read the PNG)
in dark and light, compare with the prototype, and fix what is off. Stop the
dev server when done.

## Tests

- Delete tests of components you remove; write tests for your phase's
  acceptance items and for behaviour that must survive (errors with retry,
  empty states, keyboard access, IPC calls with the right arguments).
- Run `npx vitest run <your dirs and files>` until green. Run
  `npx tsc --noEmit` and fix every error in files you touched. Other areas
  are being rebuilt in parallel in other worktrees; failures in their old
  tests are not yours, but never leave your own files red.

## Report (under 300 words)

Files added, changed and deleted; acceptance items covered and the test names;
screenshots (absolute paths, dark and light); anything not done and why; IPC
fixtures you added. Last line: `worktree <path>, uncommitted, tests <state>`.
