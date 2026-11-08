# 0119 — Agenda polish: repairs without the view, recordings in view, Outlook's colours and time zones

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

The owner's agenda on 2026-11-03 still showed four gaps after spec 0115:

- A roadmap meeting showed twice. Spec 0115 P3 joins a recording's session
  into the session prepared for its event, but only inside the IPC that
  reads calendar matches, which only the Reuniões route calls. The prepared
  session (with links) and the recorded one (blank note, no item folder, not
  mentioned) both stayed, though every condition to join them held.
- Recordings made outside the calendar were hard to find on the week grid.
  The rendering path places every session at its span, but until spec 0115
  P4's dating ran (again only from that IPC) an unscheduled recording sat as
  a 30-minute block, and a session without an event is drawn in the same grey
  as the canvas next to Outlook's coloured blocks.
- Category colours did not match Outlook. The presets were mapped, but the
  dark theme used lifted bars and near-black fills of its own, and DarkSteel
  (preset11) was drawn as a grey family while Outlook draws a dark teal.
- The hour labels in the time gutter sat across their hour line. Outlook
  hangs them just under it, and it can show extra time zones beside the
  hours, which the owner uses.

## Non-goals

- Reading Outlook's own extra time zone setting. Graph does not expose it;
  the zones are set in Coxinha.
- Colouring Outlook events without a category with the calendar's colour.
  They keep the current tone.
- Syncing preferences across computers. The zones live on this computer.

## Design

### P1 The agenda repairs itself after each refresh

- One pass joins duplicates (spec 0115 P3) and dates unscheduled recordings
  (spec 0115 P4). It runs once at startup with the cached agenda, after every
  successful background calendar refresh, and still from the calendar match
  IPC. Passes never overlap.

### P2 Every recording shows on the week grid

- A recorded session sits at its real span; one linked to an Outlook event
  is that event's block, never a second one.
- A recording the calendar does not know is drawn with the accent tone, so it
  reads as a meeting beside Outlook's blocks.

### P3 Outlook's colours

- Each preset is drawn with the colour Outlook shows for it in both themes.
  In the dark theme the fill is 55% of the colour over #141414, as measured
  on the owner's Outlook, darkened where light text would fall under 4.5:1.
  The source of the mapping is documented next to the palette.
- Only a category without a colour falls back to the neutral tone.

### P4 Week gutter like Outlook

- Hour labels hang under their line with a small inset; midnight is labelled.
- Settings → Calendar lists up to three extra time zones by IANA name with a
  short label: add, remove, move up and down. A label for this computer's
  zone heads its column. Both are saved on this computer. By default there
  are none and the gutter shows the local clock alone.
- With extra zones, the gutter shows one narrow column per zone and the local
  one last, each with the wall time at the same instant on the first visible
  day.

## Acceptance

- [x] A refresh pass joins the prepared and recorded sessions of one event,
      and a second pass changes nothing
      (`library::reconcile::tests::a_refresh_pass_joins_the_prepared_and_recorded_sessions_once`).
- [x] Recordings outside the calendar show at their real span with their own
      tone, beside Outlook events, and a session linked to an event shows once
      (`MeetingsHub.week.test.tsx` "shows every recording at its real span").
- [x] Every preset has Outlook's colour in both themes, the measured dark
      fills, and readable text on every dark fill
      (`categories.palette.test.ts`).
- [x] Hour labels for every hour, and extra zone columns with their labels
      and wall times (`MeetingsHub.week.test.tsx` "puts each hour label").
- [x] Zones are added, refused when unknown, repeated or over the limit,
      reordered, removed and persisted (`timeZones.test.ts`,
      `CalendarSection.test.tsx`).
- [ ] Owner: the duplicated roadmap meeting shows once after the next
      refresh; colours match Outlook side by side.
