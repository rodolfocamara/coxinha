# 0107 — Reuniões as the calendar

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

The owner reads the agenda in Outlook's calendar, not in a list. Reuniões
showed the same meetings twice (the "Próximas e recentes" list beside the
calendar) and opened each one beside a list. The three uses are: see what is
happening now and next, prepare ahead, and above all go back to earlier
meetings for data, summary and transcript. Editing in the grid comes later;
this layout leaves room for it.

## Non-goals

- Moving, resizing or renaming meetings in the grid (spec 0104 P5 only
  creates).
- Generating summaries; spec 0108 does. The peek reads one when it exists.

## Design

### P1 The calendar is the page

- `/meetings` is the calendar at full width: a bar (+ Nova reunião, import,
  Hoje, ‹ ›, range title, search, view switcher), an "Agora / A seguir" strip,
  a left rail, the grid (spec 0104 views with click-to-create) and, when a
  meeting is selected, a peek on the right. The list column and its tabs are
  gone; no meeting appears twice on screen.
- "Agora" is the live capture, else the meeting in progress (Gravar when it
  can be recorded, else Abrir); "A seguir" is the next meeting still today
  ("Em N min" under an hour, else "Às HH:MM") with Preparar. The strip hides
  when the day is quiet.

### P2 Rail

- A month to jump to any day; days in view are marked and today is filled.
- Outlook categories as checkboxes with their colours plus "Sem categoria";
  unchecked categories leave the grid and the search results (a row follows
  its first coloured category). The choice is remembered.
- "A revisar" with its count opens a sheet with what the old review tab
  listed (interrupted, failed, untranscribed), newest first; picking one opens
  its page. `?tab=review` / `?review=true` open it too.
- Calendar matches (spec 0100) and the Outlook status sit in the rail.

### P3 Peek

- A click selects a block and opens the peek; a double click or Enter opens
  the meeting's page. Escape (outside fields and dialogs) or ✕ closes it and
  focus returns to the block; opening moves focus to its title.
- It shows date and time with "ontem/amanhã", title, category, invitee count
  and recorded length; "Resumo" from `library_meeting_summary` (spec 0108),
  else the first lines of the personal notes; three transcript lines (those
  matching the search, else the first) with "Ver transcrição completa" to the
  page's transcript tab; files and linked activities (spec 0105).
- Actions by time: Gravar while it happens and can be recorded; Preparar
  ahead (an Outlook-only event gets a session); Abrir reunião afterwards.

### P4 Search

- Typing in the bar replaces the grid with results; "← Agenda" or Escape
  clears. Titles, invitees and category names match on the client;
  `library_search` (the CLI search of spec 0106, moved to a shared module)
  adds people the owner added, notes and transcripts with snippets.
- Results are grouped: Mais adiante, Hoje, Esta semana, Semana passada, then
  months, newest first inside each group; each row has date, title, category
  and the first non-title snippet with its field and the match highlighted
  (accent- and case-insensitive).
- Filters: período (qualquer, últimos 30 dias, este ano), pessoa, categoria,
  com transcrição.

### P5 Meeting page and URLs

- `/meetings/$sessionId`, `?event=` and `?recording=` show the meeting's page
  at full width with "← Agenda", which returns to the same view and date (the
  calendar keeps its date and search in memory). `?panel=` picks the tab.
- `?tab=week|month` and `/calendar` map to views; `?tab=calendar` to the home.

### P6 Hoje

- Hoje's agenda shows "Agora" and the next three meetings, with "Ver agenda"
  to Reuniões.

## Acceptance

- [x] Calendar first, each meeting once, no list (`MeetingsHub.home`).
- [x] Rail: jump to a day, category filter in grid, month and results,
      review sheet and old URL (`MeetingsHub.home`, `MeetingsHub.calendar`,
      `calendarHome` tests).
- [x] Strip: now and next, LiveBadge only for a live capture, Preparar
      creates the session (`MeetingsHub.home`, `calendarHome`).
- [x] Peek: click, Escape with focus return, summary then notes fallback,
      transcript excerpt, double click and Enter to the page, transcript tab
      from the peek (`MeetingsHub.home`, `calendarHome`).
- [x] Search: local and backend fields, grouping, filters, highlight,
      Escape (`MeetingsHub.home`, `calendarHome`); `library_search` shares
      the CLI search (`cli::tests`).
- [x] Back to the calendar keeps view and date; old URLs map
      (`MeetingsHub.home`, `MeetingsHub.calendar`, `calendarViews`).
- [x] Hoje shows now and the next three (`hojeData`, `HojeRoute`).
- [ ] Owner: the agenda reads like Outlook's, and an earlier meeting's data
      is found from search and the peek.

## Evidence

- Screenshots from the preview harness (dark and light): calendar with the
  peek open, search results for "headcount", and the meeting page on its
  transcript tab.
