# 0125 — Appearance: theme, colours, font size and language

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

The owner finds the interface small and asked for visual settings in the same
scheme as T3 Code, "to keep it comfortable for people". The window also shows
English on an English OS, and there was no way to choose.

T3 Code exposes `fontSizeInterface` (12 to 20, default 16), `fontSizeCode`,
`fontFamilySans`, `fontFamilyCode`, `fontSmoothing` and `appearanceContrast` (50 to
200 in steps of 5, default 100). Read from its bundle: the size is
`root.style.fontSize`, its whole UI is in rem, contrast mixes text towards the page
or towards black and white. We take the same names, ranges and meanings.

## Non-goals

- A Code/mono size. T3 Code needs one because code is its main surface. Here mono
  is shortcuts, paths and a diagnostics dump: about 15 small spots that follow the
  interface size. Notes in the mono font use the note's own size.
- Font smoothing. Measured: `-webkit-font-smoothing: antialiased` changes no pixel
  in WebKitGTK 2.54.2 or in Chromium on Linux, and MDN documents it as macOS only,
  so it would be a dead switch on WebKitGTK and WebView2.
- Recolouring Outlook's categories (spec 0119) or the status hues.
- Rebinding the window's zoom keys, or per-note sizes (the note menu keeps those).

## Design

### P1 One variable drives all type: the root font size

The setting writes `html { font-size: Npx }`. Everything that sizes text or holds
text is in rem:

- All 138 `font-size: Npx` and the `text-[Npx]` classes were converted, and a test
  forbids new ones. Tailwind's own sizes and spacing already are rem.
- Heights, padding, gaps and margins from 4 px up, and small boxes up to 120 px
  wide, too. Controls, rails and chips grow with their text, so they do not clip.
- Agenda: `HOUR_PX`, block heights and zone columns stay design pixels and are
  written as rem (`rem()`). Text and blocks scale together, so the thresholds that
  decide what a block shows hold at any size. The two places that meet real pixels,
  `minutesAt` (pointer) and `initialScroll`, multiply by `remScale()`.
- Panels above 120 px (settings list, people list, peek) keep their px width: the
  text inside wraps, and the agenda keeps the room.
- Icons are lucide attributes in px; `svg.lucide { scale }` draws them with the
  text without moving the layout.

At 16 the page computes to exactly what it did. Checked by pixel diff against the
previous build on seven screens in both themes at 1200 x 800: zero pixels change,
except the intended fixes in P3 and the new Settings section.

Rejected, with the evidence:

| Option | Why not |
| --- | --- |
| Tauri `setZoom` | Scales icons, borders and hit targets alike, so an 800 x 600 window becomes 640 x 480 of layout whatever fits. Async IPC after load: it cannot apply before first paint without keeping the setting in Rust. Not testable in the browser harness. |
| CSS `zoom` on the root | Same whole-page scale. `getBoundingClientRect` and viewport units under zoom differ between engines (Chromium changed them in 128), and the agenda's drag and the board's canvas read those. |
| `calc(Npx * var(--scale))` on each size | Works, but 138 rewrites that still leave Tailwind's 175 rem sizes needing a second mechanism. Rem is one mechanism, and what T3 Code does. |

Rem on the root font size has no engine differences to worry about: it is CSS 3,
and media queries keep using the initial size, so they keep following the window.

### P2 Layouts break on available text, not on window pixels

Container queries are in rem, so a larger font reaches a breakpoint at a wider
window. Fixed: the calendar bar drops the view and search labels to icons (with
tooltips and names kept), then wraps; below 44 rem the calendar rail folds into a
row and leaves the mini month out, and the peek floats over the grid; with the peek
open under 960 px the rail steps aside, as both have fixed px widths; the meeting
inspector and the person's side column go under the main text; settings rows
stack; week headers wrap. Several of these were already broken at 16 in a small
window.

### P3 Colour tokens are computed, never trusted

Accent is a preset (tangerine, blue, teal, green, violet, pink, graphite) or a custom
colour, by picker or hex. For each theme the generator derives:

- `--fg-on-accent`: today's warm ink if it reaches 4.5:1, else white, else black. On
  any single colour one of white and black reaches 4.5:1, so this cannot fail.
- `--accent-hover`: moves away from the foreground, so the pair only gains contrast.
- `--accent-ink`: the accent as text on a surface, moved in lightness until it
  reaches 4.5:1 on every surface. New: `text-primary` used the raw accent, 2.5:1 for
  tangerine on the light canvas. Accent text now uses `--color-primary-ink`.
- A custom colour under 3:1 against the canvas (WCAG 1.4.11) has its lightness moved
  until visible, and the row says so.
- `--selection` and the first ambient blob follow the hue. `--fg-on-danger` no longer
  borrows `--fg-on-accent`, or a dark accent would turn the danger button's text
  white on salmon.

Fixed by the same test: tangerine's light hover was 4.41:1, now `0.65 0.15 55`, 4.59:1.

The settings row shows a sample button and the computed ratio.

### P4 Contrast

As in T3 Code: below 100 text fades towards the page, above 100 it moves towards
black or white, and borders scale with it. Floors keep primary at 7:1, secondary and
tertiary at 4.5:1 and quaternary at 3.5:1 on every surface, however low the setting.

### P5 Fonts

Free text, comma separated, as in T3 Code; empty uses today's system stack. Names are
quoted when needed and characters that could close a CSS declaration are dropped.

### P6 Language

Automatic (default, today's behaviour), Português (Brasil), English. The window switches
at once, `<html lang>` follows, and `config.locale` is written so the tray and
notifications take it at the next start.

### P7 Applied before first paint

The generator's output is one stylesheet, empty at the defaults, unlayered so it wins
over the `@layer` tokens. It is saved next to the settings; the inline script in
`index.html` injects it before any module loads. `main.tsx` regenerates it from the
settings, so a new build corrects a stale copy.

Settings live in `localStorage`, like the theme.

### P8 The section

"Geral" becomes "Aparência" (`#appearance`; the legacy `appearance-heading` anchor
stays), first in the list, applying live: the app itself is the preview. Sliders are
native ranges with value text; a reset appears only when changed and hands focus back
to its slider; accents are one native radio group; choices that have no native
announcement go through a polite status line.

## Compatibility

Checked in real WebKitGTK 2.54.2 (the Linux app's engine, driven offscreen) and Chromium:
rem, `oklch`, `color-mix`, container queries, `scale`, `:has`, `::-webkit-slider-thumb`,
`input[type=color]`. WebView2 is Chromium, so the Chromium run stands in for it; not run
on Windows itself.

## Acceptance criteria

- [x] Size is 12 to 20, default 16, applied to the root and persisted.
      `AppearanceSection.test.tsx` "interface font size", `appearance.test.ts` "settings".
- [x] No px type remains in CSS or Tailwind classes. `appearance.test.ts` "type follows
      one variable".
- [x] At the defaults nothing is generated, so today's look is untouched.
      `appearance.test.ts` "stylesheet".
- [x] Agenda pointer and scroll stay correct at any size. `agendaScale.test.ts`,
      `MeetingsHub.week.test.tsx`, `appearance-interaction.mjs` (one hour is 60 px at 20,
      a drag proposes the right time).
- [x] Settings apply with no app code loaded. `appearance.test.ts` "before first paint",
      `appearance-interaction.mjs`.
- [x] No clipped, escaping or overlapping text, and native date and time fields with room
      for their value, at 12, 16 and 20, dark and light, 1200 x 800 and 800 x 600, on Today,
      week, month, a meeting, People, Settings, Workspace, the peek, the new meeting sheet
      and the palette. `pnpm audit:appearance` (both languages, every size step in a sweep),
      `webkitgtk-audit.py` (first seven screens).
- [x] Foreground on accent and on hover, accent as text, primary on soft fill: at least 4.5:1
      for every preset in both themes. `contrast.test.ts` "accent".
- [x] Any custom colour gets a readable foreground. `contrast.test.ts`, over 343 colours
      and the mid-grey worst cases.
- [x] Primary, secondary and tertiary text reach 4.5:1 on every surface at every contrast
      setting. `contrast.test.ts` "text on every surface".
- [x] JS tokens equal `index.css`. `contrast.test.ts` "index.css and the generator agree".
- [x] Outlook's categories are never recoloured. `contrast.test.ts`.
- [x] Language: Automatic, Portuguese, English; window and native locale follow.
      `AppearanceSection.test.tsx` "language".
- [x] Every control works by keyboard, and changes are announced. `AppearanceSection.test.tsx`,
      `appearance-interaction.mjs`.
