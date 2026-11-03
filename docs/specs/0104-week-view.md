# 0104 — Week view in Reuniões

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

- Creating, moving or resizing meetings by dragging. Blocks open the meeting;
  Outlook stays where the calendar is edited.
- Day and work-week views, working-hours shading, time-zone columns.
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

## Acceptance

- [ ] Week start, day columns, clipping at midnight, minimum height, default
      lengths and lane packing of overlaps (`weekLayout` tests).
- [ ] All-day events land on their civil days, including multi-day ones
      (`weekLayout` tests).
- [ ] The tab renders the week with blocks in their day columns, categorized
      blocks carry the category colour and name, navigation changes the range
      and a block opens the meeting (`MeetingsHub.week` tests).
- [ ] Owner's Reuniões: the week reads like Outlook's week view.
