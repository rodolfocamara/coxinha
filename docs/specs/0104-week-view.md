# 0104 — Calendar views in Reuniões

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

The owner plans the week in Outlook's week view: seven day columns, an hour
axis, each meeting a block as tall as it lasts, coloured by its category.
Reuniões offers a list and a month grid; the month grid shows what happens on
a day but not when, how long, or what overlaps. The owner asked for the week
"like in Outlook".

## Non-goals

- Moving, resizing or renaming meetings in the grid. Blocks open the meeting;
  Outlook stays where existing events are edited. Creating from an empty
  slot is P5.
- Working-hours shading, time-zone columns.
- Outlook's first day of the week. The week starts on Monday, as the month
  grid and the period filters already do.

## Design

### P1 Tab and navigation

- Reuniões gets a "Semana" tab between "A revisar" and "Mês"
  (`?tab=week`). Like the month grid, it replaces detail and inspector, and a
  block opens the meeting in the list view.
- The header has previous, "Hoje" and next buttons and the range as title,
  e.g. "3–9 de novembro de 2026" (`Intl.DateTimeFormat.formatRange`), with
  the same legend as the month grid.

### P2 Grid (`weekLayout.ts`, `WeekView.tsx`)

- Seven columns headed by weekday and date; today's date is highlighted.
- An all-day strip above the hours holds all-day events on every civil day
  they cover. All-day dates come from the event's date text, never from
  converting midnight UTC to local time.
- The hour axis covers the whole day at 48 px per hour and scrolls; it opens
  at one hour before now in the current week, else at 07:00.
- A block's top and height follow its start and end on that day, clipped at
  midnight, at least 15 minutes tall. Rows without an end (loose recordings,
  sessions not finished) last 30 minutes, or until now while live.
- Overlapping blocks split the column side by side: blocks that overlap form a
  cluster, each takes the first free lane, and the cluster's width is shared
  by its lanes, as Outlook does.
- A red line marks the current time in today's column.

### P3 Blocks

- A categorized block is filled with the category (spec 0103 fill and bar).
  An Outlook event without a colour has a neutral fill and Outlook's blue bar;
  a meeting without an event has a neutral fill and a grey bar; a live one a
  live-coloured bar. Cancelled events are faded and struck through.
- The block shows the title, then the time range and the organizer when it is
  tall enough. Every block is a native button whose accessible name carries
  the time, the title and the category; buttons follow day and time order.

### P4 One calendar page (2026-11-03)

The owner asked for Outlook's switcher on one page instead of separate
"Semana" and "Mês" tabs, and for the calendar to follow the search.

- One "Calendário" tab replaces "Semana" and "Mês":
  `?tab=calendar&view=day|workweek|week|month`, plus `&days=1..7` for the
  day view. `?tab=week`, `?tab=month` and `/calendar` open the matching
  view. The last view and day count are remembered (localStorage) and used
  when the URL names no view.
- The toolbar follows Outlook's order: a "Dia" split button (the menu picks
  1–7 days), "Semana de trabalho", "Semana" and "Mês" as one toggle group,
  then "Hoje", previous, next and the range title.
- Day view shows N columns from the anchor date (today when opened); work
  week is Monday–Friday; week is Monday–Sunday. Previous and next move by
  the days shown: N for the day view, 7 for the weeks, a month for the
  month.
- The time grid takes any list of days (`calendarViews.ts` picks them); the
  month grid is the same as before, under the shared toolbar.
- The list's search box filters every view, by title, people, organizer and
  category name. When it hides everything in range, the toolbar says so; the
  grid stays.

### P5 Create from the grid (2026-11-03)

The owner chose one way to edit: pick an empty slot and create a Coxinha
meeting there, optionally also in Outlook. Nothing else in the grid edits.

- In the day, work week and week views, a click on an empty slot snaps to
  the half hour and proposes 30 minutes; dragging up or down in one column
  selects a range snapped to 15 minutes, at least 15 minutes long, never
  past 23:59. A translucent block with the time range follows the drag;
  Escape cancels it. A press on a meeting block still opens the meeting and
  never starts a selection.
- Releasing opens the existing "Nova reunião" sheet with the date, start and
  end filled in; nothing is created until the owner confirms there. The
  "Nova" button stays the keyboard path; empty slots are not focusable.
- The sheet has "Criar também no Outlook", off by default. It is enabled only
  when Outlook is connected with write access (`categoryAccess.write`, spec
  0103); otherwise it is disabled with a hint and "Reconectar Outlook".
- With it checked, the session is created first; then
  `calendar_create_event` posts an event to the default calendar with the
  same subject, start and end (UTC `dateTime`, `timeZone: "UTC"`),
  `showAs: busy`, no body and no attendees, so nobody is invited. The
  session ID is the Graph `transactionId`, so a retry never makes a second
  event. A 403 clears write access, as for categories. The cache is
  refreshed (the created event is added if the refresh misses it), so the
  session matches the event by title and start (`matchEvent`).
- If Outlook fails, the session stays; the sheet says the Outlook part
  failed and offers "Tentar de novo" and "Abrir reunião".

## Acceptance

- [ ] Week start, day columns, clipping at midnight, minimum height, default
      lengths and lane packing of overlaps (`weekLayout` tests).
- [ ] All-day events land on their civil days, including multi-day ones
      (`weekLayout` tests).
- [ ] The tab renders the week with blocks in their day columns, categorized
      blocks carry the category colour and name, navigation changes the range
      and a block opens the meeting (`MeetingsHub.week` tests).
- [ ] Owner's Reuniões: the week reads like Outlook's week view.
- [x] Day ranges for every view, navigation steps and remembered prefs
      (`calendarViews` tests).
- [x] One "Calendário" tab: the switcher, the 1–7 day menu, work week with
      five columns, old URLs mapped, the remembered view used, search
      filtering the grid including by category name
      (`MeetingsHub.calendar` tests).
- [x] Grid selection: click snaps to the half hour for 30 minutes, drag
      snaps to 15 minutes with a 15-minute minimum and the 23:59 cap
      (`gridSelect` tests).
- [x] Click and drag open the sheet prefilled, a press on a block opens the
      meeting instead, Escape cancels (`MeetingsHub.create` tests).
- [x] "Criar também no Outlook": disabled without write access with the
      reconnect hint; creates the session then the event; an Outlook failure
      keeps the session and retries the same event (`MeetingsHub.create`
      tests).
- [x] Event body with UTC times, no attendees, `showAs: busy` and the
      transaction ID; URL and 403 handling (`calendar::create` tests).
