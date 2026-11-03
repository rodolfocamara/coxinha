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
- Colour fills behind text. Colour marks the data; the chrome stays neutral.
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

- Presets map to Outlook's named colours (Microsoft Graph `outlookCategory`
  table: Red, Orange, Brown, Yellow, Green, Teal, Olive, Blue, Purple,
  Cranberry, Steel, DarkSteel, Gray, DarkGray, Black, DarkRed, DarkOrange,
  DarkBrown, DarkYellow, DarkGreen, DarkTeal, DarkOlive, DarkBlue, DarkPurple,
  DarkCranberry). Each has a light-theme and a dark-theme value
  (`--outlook-cat-N` in `categories.css`) so a mark stays visible on both
  canvases.
- An event's colour is its first category that has a colour in the master
  list. Sessions linked to an event take the event's colour.
- Reuniões list: a 3 px bar at the row's left edge. Month grid: the item dot
  takes the colour (live still wins). Hoje agenda: the same bar. Each mark
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
- [x] List rows, month items and Hoje rows show the first coloured category
      with its name for screen readers; linked sessions use the event's
      colour (`categories` UI tests).
- [x] Picking a category updates the colour before the backend answers,
      sends the PATCH and rolls back on failure; missing scope shows the
      reconnect state (`categories` UI tests).
- [ ] Owner's Outlook: categories and colours match Outlook after
      reconnecting, and a change made in Coxinha shows in Outlook.
