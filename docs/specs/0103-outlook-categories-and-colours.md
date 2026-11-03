# 0103 — Outlook categories and colours

Status: in-progress
Phase: F1
Date: 2026-11-02

## Why

People sort their Outlook calendar with categories, each with a colour
(the owner uses Analysis, Architect, CTO, De Fora, Human Resources, Manager,
Personal, UX). Coxinha shows the same meetings without that colour, so the
agenda reads as one grey list. The owner wants the meetings coloured the way
Outlook colours them, and wants to fix a meeting's colour by categorizing it
correctly from Coxinha.

## Non-goals

- Creating, renaming or recolouring master categories. Outlook owns the
  list; Coxinha reads it.
- Categories on sessions or recordings without an Outlook event. Colour comes
  from the event a session is linked to (`matchEvent`).
- Changing the auth method. Same public client, loopback redirect and PKCE;
  only the requested scopes grow.

## Design

### P1 Read categories (`src-tauri/src/calendar/categories.rs`)

- The calendar request selects `categories`; each cached event keeps its
  category names in Outlook's order.
- Each sync reads `GET /me/outlook/masterCategories` and caches the list as
  `{ name, preset }`, where `preset` is the Outlook colour preset `0`–`24`
  (`preset0`…`preset24`) or `null` for `none`. Older caches without these
  fields still load (empty lists).
- A failed master-list read never fails the sync: a 403 means the scope is
  missing; any other failure keeps the last cached list.

### P2 Scopes and reconnect

- Connecting asks for `Calendars.ReadBasic Calendars.ReadWrite
MailboxSettings.Read openid offline_access` (dynamic consent, no app
  registration change).
- Refreshing keeps asking for `Calendars.ReadBasic openid offline_access`,
  which every earlier connection granted, so an existing connection keeps
  syncing. Entra returns every scope consented for Graph, and the token
  response's `scope` field says which: `MailboxSettings.Read(Write)` grants
  reading the master list, `Calendars.ReadWrite` grants changing categories.
- The cache carries `categoryAccess { read, write }`. When either is missing
  the inspector and the Outlook card say "Reconnect Outlook to use
  categories" and offer the Outlook sheet; nothing else changes.

### P3 Colours

- Presets keep Graph's names (Red, Orange, Brown, Yellow, Green, Teal, Olive,
  Blue, Purple, Cranberry, Steel, DarkSteel, Gray, DarkGray, Black, DarkRed,
  DarkOrange, DarkBrown, DarkYellow, DarkGreen, DarkTeal, DarkOlive, DarkBlue,
  DarkPurple, DarkCranberry), but the new Outlook draws each one with a Fluent
  colour family: cranberry, darkOrange, peach, marigold, lightGreen,
  lightTeal, lime, cyan, lavender, pink, steel, silver, beige, mink, anchor,
  darkRed, bronze, darkBrown, gold, darkGreen, darkTeal, forest, darkBlue,
  darkPurple, plum. Hex values come from Fluent's global palette
  (`@fluentui/tokens`), not from guesses.
- Each preset has a mark (`--outlook-cat-N`) and a fill (`--outlook-cat-N-bg`)
  per theme. Light: Fluent primary on a tint50 fill. Dark: the fill Outlook's
  dark theme uses (shade30 or shade40 of the family) and a tint30 mark, so dark
  families still read on Coxinha's near-black canvas.
- Evidence (owner's Outlook screenshot, 2026-11-02): CTO events draw a bar of
  `#06586b` on `#0e3942` (Fluent steel primary `#005b70`, shade30 `#00333f`);
  events without a category draw Outlook blue `#0772c9` on `#104776`; the
  selected Analysis event fills with peach shade30. Blue (preset7) is the
  least certain family: its dark fill matches no Fluent shade exactly.
- An event's colour is its first category that has a colour in the master
  list. Sessions linked to an event take the event's colour, so a recording
  accepted against a calendar event (spec 0100) is coloured too.
- A categorized meeting is a filled block with a bar at its left edge, as in
  Outlook: Reuniões list rows, Hoje agenda rows and month items. The selected
  row outlines its block with the mark colour. Meetings without a category
  stay unfilled, so the Gray preset never reads as "no category". Each block
  carries the category name for screen readers.

### P4 Change categories

- The inspector of a meeting linked to an Outlook event shows a Categories
  section: the event's categories as coloured chips and, with write access,
  "Change" opens the master list as toggle buttons.
- A toggle applies at once: the colour changes everywhere (optimistic), the
  app `PATCH`es `/me/events/{id}` with `{"categories": [...]}` (immutable ID,
  `calendar_set_categories`) and rewrites the cached event. On failure the
  change rolls back and the error is shown; a 403 also clears write access.
- For a recurring meeting the change applies to that occurrence only, as
  Outlook does when one occurrence is edited.

## Acceptance

- [x] Presets map to colour indexes; `none` and unknown values have no
      colour (`categories` tests).
- [x] Master list and event categories parse; caches without them still load
      (`categories` tests).
- [x] Granted scopes decide read/write; a 403 reads as missing scope; other
      failures keep the last list; refresh keeps the pre-0103 scope
      (`categories` tests).
- [x] PATCH body, event URL encoding and cache rewrite (`categories` tests).
- [x] List rows, month items and Hoje rows are filled with the first coloured
      category, with its name for screen readers; linked sessions use the
      event's colour (`categories` UI tests).
- [x] Every preset has a mark and a fill in both themes, from the Fluent
      palette the new Outlook uses (`categories.palette` test).
- [x] Picking a category updates the colour before the backend answers,
      sends the PATCH and rolls back on failure; missing scope shows the
      reconnect state (`categories` UI tests).
- [ ] Owner's Outlook: categories and colours match Outlook after
      reconnecting, and a change made in Coxinha shows in Outlook.
