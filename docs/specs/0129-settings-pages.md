# 0129 — Settings as pages: one section per route, grouped sidebar, find a setting

Status: in-progress
Phase: F1
Date: 2026-11-04

## Why

The owner asked to look at settings screens, like T3 Code's, because "there are already
enough options not to leave everything on one screen". Today eight sections share one
scrolling column about 3,400 px tall at 1200 x 800, beside a flat list that follows the
scroll. Finding "fuso" means knowing it sits under a section named after something else, and
a link from elsewhere lands in the middle of everything.

This is organization, not behaviour. No setting changes meaning, default or stored key, and
no opt-in turns on.

## Non-goals

- Rebinding shortcuts (spec 0128), switching the notes folder, or any new setting.
- An About page. The version exists only inside the diagnostics text, and the app ships no
  licence list. T3 Code has `/settings/about` and `/settings/open-source-licenses` because it
  has that content; we would be building an empty page. The diagnostics text stays the place
  for the version.
- Restyling the Outlook card. It is shared with the agenda's connect sheet
  (`MeetingsHubRoute.tsx`), so its form and footer stay. Only its heading level changes.

## Design

### P1 One page per section

`/settings/$section` is a real route. `/settings` redirects, replacing the history entry, to
the first page. Exactly one page shows, with its own scroll, an `h1` and a one-line
description. An unknown section goes to the first page.

Moving between pages goes through the router, so back and forward follow the section, and the
window title reads "Aparência · Ajustes · Coxinha" (`document.title` and, in the app, the native
title, since Tauri does not sync the two: `core:window:allow-set-title` is new in the capabilities).

Every page stays mounted and the others are `hidden`:

- A half-typed model path, the open "other folders", a finished rebuild's result or a running
  model download survive going to another page and back. Unmounting would lose them, because
  fields that save on blur get no blur when React removes them.
- Each page's scroll position is kept and restored, as `display: none` does not reliably keep
  it across engines.
- It costs nothing new: all sections are mounted on opening Settings today, with the same reads.

Rejected: mounting only the current page (loses the above) and a scroll-spy over one column
(what we are leaving; a sidebar of anchors into one page was marked down in the app-screen
study for exactly this).

### P2 Sidebar in named groups

| Group | Pages |
| --- | --- |
| App | Aparência, Atalhos |
| Reuniões | Gravação, Transcrição, Agenda |
| Conexões | Integrações, Títulos e resumos |
| Sistema | Armazenamento, Diagnóstico |

The owner's starting point, with one change, taught by the code: **Títulos e resumos** is its own
page under Conexões. It was a card inside Integrações, and it is the only other thing that sends
data off the computer (transcript text, to the owner's server over SSH). So "Conexões" holds a
checkable promise: only pages in this group can make anything leave the machine, which is the
question this app must answer plainly under the zero-network invariant. It also stops Conexões
being a group of one. A person looking for summaries under Reuniões has the filter and the
direct link from the meeting panel.

Moves and non-moves, after reading each section:

| Option | From | To | Why |
| --- | --- | --- | --- |
| Suggested title, SSH target, port, model, test | Integrações | Títulos e resumos | See above. One page, because the switches are disabled until the server is filled in; splitting them would hide the reason on another page. |
| Generate summaries | Integrações | Títulos e resumos | Same server and same gate. |
| Call detection, automatic recording, stop when the call ends | Gravação | Stays, own group "Chamadas" | Automatic recording needs detection (ADR 0023), and stop applies to every recording. Together they are what happens to a call; devices are a different question. |
| Live transcription, backlog, model, threads | Transcrição | Stays, group "Automática", first | The only controls on the page. The read-only engine rows follow. |
| Contrast | Appearance flat list | Group "Texto" | Its own hint says it is about text. |
| Gradient background | Last in Appearance | Group "Tema e cor" | It belongs with the look of the window. |

"Agenda e fusos horários" and "Transcrição local" shorten to "Agenda" and "Transcrição" in the
sidebar. Their descriptions keep the rest.

Active item: a neutral pill, as in the references, instead of the accent bar. Groups are
sentence-case grey labels, not uppercase.

### P3 Inside a page

Titled groups only where they help, each a card of the same row, on every page:

- Aparência: **Tema e cor** (theme, accent, gradient), **Texto** (size, contrast, interface font,
  mono font), then language alone in an untitled card, as a title "Idioma" over a row "Idioma"
  says nothing.
- Gravação: **Dispositivos**, **Chamadas**.
- Transcrição: **Automática**, **Modelos das reuniões**.
- Títulos e resumos: **Seu servidor**, **O que ele faz**.
- Atalhos, Agenda, Armazenamento, Diagnóstico: few rows, no titles.

The suggested-title card becomes rows of the same grammar. Its fields keep their labels and
save-on-blur.

The row: as the property sheet (spec 0126 P9), a quiet glyph beside the label. The tinted tile
around the glyph goes, so every row loses 0.75 rem of noise, and the shortcut rows gain a glyph,
so all rows line up. The page title has no icon: the sidebar already shows it.

### P4 Find a setting

A compact filter at the top of the sidebar. The index is a table
(`src/features/settings/settingsIndex.ts`), never a DOM scan: each row names its page, its anchor
and the locale keys for its title, hint and optional synonyms. Matching ignores case and accents;
title matches come first. The results replace the sidebar while typing, each with its page's name.

It is a combobox: arrows move, Enter opens, Escape clears, and a status line says how many were
found. Picking one opens the page, clears the filter, moves focus to the row's title and marks the
row while focus stays there. A test checks that every table row exists on its page, so the table
cannot drift.

Ctrl+K searches the same table, shown only once something is typed.

### P5 Deep links

Callers use `settingsLocation(id)`, which reads the table, so a moved row cannot leave a stale
link. Updated: `hojeNavigation.ts`, `CalendarToolbar.tsx`, `PeekResult.tsx`,
`NoteFileSettingsLink.tsx`.

`/settings#<x>` keeps working forever by redirect, for every form that resolved before:
`#<section>`, `#<section>-heading`, `#vault-heading`, and any row's id or title anchor, such as
`#rebuild-heading`, `#detection-heading`, `#integrations-outlook-heading`. `#titles-heading` and
`#summaries-heading` follow the row to its new page; `#integrations` stays on Integrações. A hash
on the wrong page moves to the right one. An unknown hash opens the first page, as it did.

A row that loads after the page (the backend's answer) still gets focus when it arrives, unless
the owner has moved on.

### P6 Small window

The break is on available text, in rem, as in spec 0125 P2: below 44 rem the sidebar folds into a
bar over the page, holding the filter and a native selector with the groups as `optgroup`s.
Native, so the keyboard and screen readers work for free, and it cannot clip in any language.
A list-then-page flow would add a step and a back button to every change, for a window that still
fits one page's content.

The sidebar and the page column are in rem, so they grow with the text. The page column is centred
at 46 rem. This replaces the fixed 220 px of spec 0125 P1 for this one panel: the bar takes over
when the text no longer fits, so the px width no longer needs to protect the content.

## References

Mobbin, seen for this spec:

- [Linear preferences](https://mobbin.com/screens/d4e47b31-9152-40c7-a400-c6725e8de647): titled
  groups of one-card rows, label and hint left, control right. The model for P3.
- [Notion preferences](https://mobbin.com/screens/e46933bc-a321-4bde-811c-dfe1bc826468) and
  [Buffer](https://mobbin.com/screens/0398e56b-5120-4055-9348-2b046ded2e97): sidebar in named
  groups beside one page with its title. The model for P1 and P2.
- [Attio](https://mobbin.com/screens/e1752107-979b-4bda-a376-dd3dea959e38): page title with a
  one-line description.
- [Todoist](https://mobbin.com/screens/20bc3dc4-77c1-4e23-b1af-df8c411c3c62) and
  [Devin](https://mobbin.com/screens/0858df95-ec2b-4f7e-acd8-77bf1a0bf43a): the search field on top
  of the settings sidebar. The model for P4.
- [Slack preferences](https://mobbin.com/screens/ec3aedc7-cade-432c-a561-af5c1b9c3d24): the flat list
  we are leaving; it holds up at 13 items only because each page is short.

T3 Code's bundle gave the route shape (`/settings/appearance`, `/settings/keybindings`, ...).
Granola is not on Mobbin; a search for it returned other products.

## Acceptance criteria

- [x] `/settings` opens the first page, replacing the history entry; an unknown section does too.
      `settingsRoute.test.tsx` "routes".
- [x] Exactly one page is visible, with an `h1` and a description, for all nine.
      `SettingsPages.test.tsx` "one page".
- [x] Back and forward follow the section; the window title follows it and comes back on leaving.
      `settingsRoute.test.tsx` "history", `SettingsPages.test.tsx` "window title".
- [x] A half-typed field and a page's scroll survive going away and back.
      `SettingsPages.test.tsx` "keeps", `settings-pages.mjs`.
- [x] The sidebar shows the four groups in order, with `aria-current="page"` only on the current
      page, reachable and operable by keyboard; focus moves to the page title.
      `SettingsPages.test.tsx` "sidebar", `settings-pages.mjs`.
- [x] Every row in the table exists on the page it names. `SettingsPages.test.tsx` "the table".
- [x] Options moved as listed, with stored keys and calls unchanged.
      `SettingsPages.test.tsx` "moves", `live.test.tsx`, `SummaryBlock.test.tsx`.
- [x] The filter finds "fonte", "fuso" and "microfone", ignores accents, works from the keyboard,
      opens the page and focuses the row. `settingsIndex.test.ts` "match",
      `SettingsPages.test.tsx` "filter", `settings-pages.mjs`.
- [x] Ctrl+K lists settings only after typing, and picking one opens the row.
      `CommandPalette.test.tsx` "settings".
- [x] Every old hash form lands on the right page and row. `settingsIndex.test.ts` "every old hash
      form", `settingsRoute.test.tsx` "old links", `settings-pages.mjs`.
- [x] Callers go to the new route. `HojeRoute.test.tsx`, `MeetingsHub.week.test.tsx`,
      `MeetingsHub.signals.test.tsx`, `NoteRecovery.*.test.tsx`, `NoteDetailError.test.tsx`.
- [x] Below 44 rem the sidebar is a bar with a selector that changes page.
      `settings-pages.mjs`, `SettingsPages.test.tsx` "selector".
- [x] No clipped, overflowing or overlapping text on any page, at 12, 16 and 20, dark and light,
      pt-BR and English, 1200 x 800 and 800 x 600. `pnpm audit:appearance --screens <the nine>
      --locales pt-BR,en`.
- [x] Before and after on one sheet. `tools/ui-preview/settings-contact-sheet.mjs`,
      `docs/design/settings/pages.png`.
