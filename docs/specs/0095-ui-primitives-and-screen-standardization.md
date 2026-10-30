# Spec 0095: UI primitives and screen standardization

- **Status:** in-progress
- **Phase:** F2
- **Owner:** Rodolfo
- **Depends on:** DESIGN.md (`docs/research/ui-audit/DESIGN.md`), spec 0057
  (app shell), spec 0048 (calendar), spec 0092 (global people).
- **References (structure only, never brand):**
  [Todoist calendar settings](https://mobbin.com/screens/40e15bd1-ed2c-4933-982f-536416b225b7),
  [Front new contact sheet](https://mobbin.com/screens/edcf4702-124a-4a9f-aca4-5801fec2e3b0),
  [Rise event detail](https://mobbin.com/screens/caa4a4c2-fdca-40d9-8048-f5c27da9573e).

## Why

A UI audit on 2026-10-29 found 164 buttons with about 68 distinct class strings
(63 unstyled), 49 inputs with about 24 variants, 60 arbitrary pixel sizes,
four icon-button sizes and three unlayered feature stylesheets (`settings.css`,
`select.css`, `board.css`) that silently override Tailwind utilities.
DESIGN.md already defines buttons, inputs and cards, but only `Select` exists
as a shared component, so every screen re-implements them.

Features are also hidden: the Outlook connection and the capture/import
library are reachable only through underlined text links or the palette, and
the calendar toolbar misaligns because labels, selects and buttons of different
heights share an `items-start` wrapping row padded with `mt-6`.

## Scope

### In

1. **Cascade fix.** Feature and component stylesheets live in
   `@layer components`, so utilities in JSX always win.
2. **Primitives** in `src/components/ui/`, styled by `ui.css` classes in
   `@layer components` and using only existing tokens:
   - `Button`: variants `primary | secondary | ghost | danger`, sizes
     `sm` (32px) and `md` (36px), optional leading icon, `iconOnly`.
   - `Input`, `Textarea`: 36px height (`sm` 32px), 13px text, token border,
     `aria-invalid` styling, 2px accent focus ring with 2px offset.
   - `Field`: label above, optional hint, error below (`role="alert"`),
     required marker, and ids wired through `aria-describedby`.
   - `Card` with `CardHeader` (title, description, actions), `CardBody`,
     `CardFooter`.
   - `PageHeader`: title, description and an actions slot. One per route.
   - `Alert`: tones `error | warning | info | success`, token colours only.
   - `EmptyState`: title, description, optional action.
   - `Badge`: neutral, success, warning, danger.
   - `Sheet`: right-side modal panel (Radix Dialog) with header, scrollable
     body and a footer for Cancel/Confirm.
   - `Select` gains a `block` width option and the shared control height.
3. **Navigation.** Every feature is reachable from the rail or from a real
   button: the meeting library (capture and import) gets a rail entry,
   Settings gains an **Integrations** section with the Outlook calendar card
   (status, connect, sync, disconnect, open agenda), and the Settings footer
   text links are removed.
4. **Screens migrated to primitives:** Agenda, Settings, Calendar
   toolbar/period selector, People (list plus "Add person" sheet), meeting
   library, session heading/recording and the sidebar recording status.

### Out

- The activity board canvas (`board.css`) keeps its own visual language in
  this spec; it only moves into `@layer components`.
- No new colours, fonts or radii. No dependency besides
  `@radix-ui/react-dialog`.
- Behaviour, IPC and data contracts are unchanged.

## Rules (normative for new UI)

- Controls share one height per size: `md` 36px, `sm` 32px. Rows that mix
  labelled fields and buttons align on the bottom edge (`items-end`).
- Primary actions use `Button variant="primary"`; at most one per view region.
  Navigation to another feature uses a `Button` or a rail item, never an
  underlined text link. Inline text links are for prose only.
- Errors use `Alert` or `Field` errors, never raw `text-red-*`.
- Arbitrary `text-[Npx]` values are not allowed in migrated files; use
  `text-xs` (12px), `text-ui` (13px) or `text-sm` (14px).
- Radius: controls `rounded-sm` (6px), cards and sheets `rounded-md` (10px).

## Acceptance

1. Primitives have unit tests for variants, disabled state, label/error
   wiring (`aria-describedby`, `aria-invalid`), required marker and Sheet
   open/close with Escape and focus return.
2. A test proves utilities override layered component CSS (the stylesheets
   declare `@layer components`).
3. The rail exposes the meeting library; Settings exposes the Outlook card;
   no route keeps a text link as its only entry point to Agenda or Library.
4. The calendar toolbar renders its controls in one bottom-aligned row with
   matching heights (class-level assertions plus a browser screenshot).
5. People: "Add person" is the primary action and opens a Sheet with a
   labelled form, Cancel and Create, and an inline reason when Create is
   disabled.
6. Existing behaviour tests keep passing; changed copy is in both locales.

## Evidence

### R1 (2026-10-29)

- Primitives: `Button`, `ButtonLink` (route links with button look and link
  semantics), `Field` (context wires id, `aria-describedby`, `aria-invalid`,
  `required`; the required marker is CSS-only so the accessible name stays the
  plain label), `Input`, `Textarea`, `Card*`, `PageHeader`, `Alert`,
  `EmptyState`, `Badge`, `Sheet` (restores focus to the opener; Radix only
  restores to a `Dialog.Trigger`). Tests: `primitives.test.tsx` (11).
- Cascade: every component/feature stylesheet starts with
  `@layer theme, base, components, utilities;` and wraps its rules in
  `@layer components`. The explicit order is required: a component imported
  before `main.tsx` imports `index.css` otherwise declares `components` first
  and Tailwind preflight (`base`) overrides it, which a browser screenshot
  caught (buttons rendered as plain text). `@import` stays outside the block.
  Guarded by `layering.test.ts`.
- Navigation: rail entry `/meetings` ("Gravações"); Settings > Integrações with
  the shared `OutlookConnectionCard` (`useOutlookConnection` hook, same IPC);
  Agenda uses `PageHeader` with Sync/Configure; Settings footer links removed.
- Calendar: filters in one `items-end` row of 36px controls, navigation group
  on its own row, custom period row with Apply/Cancel, no `mt-6`.
- People: primary "Adicionar pessoa" opens `PersonFormSheet` (also used by
  speaker review), with Cancel/Create and an inline reason when Create is
  disabled.
- Library, session heading/recording and sidebar recording status use the
  primitives; former underlined links are `ButtonLink`s to the same routes.
- Suite: 99 files, 686 tests passing (run twice). `testTimeout` raised to 15s:
  route/remount integration tests take 1-2s alone and crossed 5s under load.
- Browser screenshots with a mocked Tauri IPC (dark and light): calendar,
  people + sheet, recordings, settings/integrations, agenda.

### Remaining

- Activity board (`board.css`, hardcoded hex colours) and `MeetingReminder`
  (`amber-*` utilities) are not migrated yet.
- `voiceButton`/`voiceField` remain for SpeakerCard, VoiceComparisonPanel and
  SelectedVoiceEnrollment.
- Native acceptance in the Tauri window on Linux and Windows.
