# Spec 0048: Calendar integration (Agenda + OS calendar)

- **Status:** draft
- **Meeting-library scope update (2026-10-19):** The
  [speaker recognition and calendar plan](../plans/2026-10-19-speaker-recognition-and-calendar.md)
  revises this draft for the meeting library: Microsoft first, explicit sync,
  private remote cache separate from canonical meeting links/snapshots, and
  attendee names used only as review candidates. The polling, notes-first UI,
  Google prerequisite and plaintext-token fallback below are not requirements
  of that increment. No calendar metadata proves presence or voice identity.
- **Phase:** F2
- **Owner:** Rodolfo
- **Depends on:** spec 0006 (app shell), spec 0009 (meetings
  list), spec 0024 (OAuth Microsoft), spec 0025 (OAuth Google).
  Reads from the OAuth specs when they land; works with local
  `.ics` files in the meantime.
- **Relevant ADRs:** ADR-0002 (local-first — calendars cache
  to disk)
- **Layer:** Input → Knowledge (calendar events are
  authoritative from the external source; cached locally)

## Why

The Agenda view today is just "today's daily note". In practice
a work day is structured by calendar events — standups, client
syncs, 1:1s. If Coxinha knows the day's calendar, it can:

- Show the day's meetings as chips above the daily note.
- Offer "Start note from this event" — pre-fills a meeting
  note with attendees + title from the calendar event.
- Drive pre-meeting briefing (spec 0035) by knowing when a
  meeting is about to start.

Obsidian's Calendar plugin (liamcain) is the closest pattern:
month-grid sidebar with density meter per day. We extend that
with actual calendar-event integration on top.

## Scope

### In

- **Calendar providers** (pluggable, reads only):
  - **Google Calendar** via OAuth + Calendar API (spec 0025)
  - **Microsoft 365 / Outlook** via OAuth + Graph API (spec 0024)
  - **Local `.ics` file** — points at a file on disk, polls
    every 5 minutes. For users who export from another tool.
- **Calendar cache** under `.coxinha/calendar/<provider>.json`
  — one file per connected account. Rebuildable from the
  source; never authoritative.
- **Sync policy (adaptive):** pull every 15 minutes at rest;
  tightens to every 2 minutes within the 10-minute window
  before any known event starts. This keeps the pre-meeting
  briefing (spec 0035) accurate without hammering the
  provider all day. On-demand pull via a menu button; stale-
  while-revalidate read from cache on boot.
- **Agenda strip** (horizontal scroll) at the top of the
  `/agenda` route:
  - 14 days visible at a time (3 past, today, 10 ahead)
  - Each day cell: date number, tiny weekday label, density
    dot (sized by note word count + event count), colored
    tick per calendar event
  - Click a day → opens that day's daily note in the current
    tab (creating it if absent)
  - Keyboard: `← →` jumps days; `Ctrl+← →` jumps weeks
- **Today's events row** below the strip on the Agenda:
  - Chips in chronological order
  - Each chip: time (mono, short form), title, attendee avatars
    (first 3, mini circles)
  - Click a chip → opens the meeting note (creates from
    template if absent), pre-fills `meeting:` frontmatter
    linking to the calendar event id
- **Calendar account management** in Settings: list of
  connected accounts + "Connect Google / Microsoft" buttons
  + "Add local .ics file" picker.
- **Privacy:** events stay local, never uploaded anywhere.
  The OAuth tokens live in the OS keychain (Windows Credential
  Manager) per spec 0023 once it lands; plain-file fallback
  in `.coxinha/secrets/` only with explicit user opt-in.

### Out

- **Writing to calendars** — read-only in F2. Creating /
  editing events is a future spec.
- **Meeting invites (RSVP)** — read-only sees attendance
  status, but doesn't let user respond. Future.
- **iCal subscription feeds** with HTTPS URLs — punt to the
  local .ics path + manual download for F2. Next iteration
  adds subscription.
- **Time-zone editor** — uses OS time zone. Global edit in
  Settings defers to a later spec.
- **Reminder notifications** — the pre-meeting briefing spec
  0035 handles this; out of scope here.

## Behavior (acceptance)

1. **Connect Google** end-to-end: OAuth flow (spec 0025) →
   event list cached in `.coxinha/calendar/google-$id.json`.
2. **Local .ics** — point at a `.ics` file on disk; events
   appear in the agenda strip within 1 poll cycle.
3. **Agenda strip** renders with density dot sized by note
   word count (from DB) + event count (from cache). Vitest
   with a fixture of 14 days of data.
4. **Click a day** opens the daily note; if absent, creates
   via `get_or_create_daily_note`.
5. **Click a today event** opens a meeting note. If no
   meeting note exists for this event id, creates from
   template with attendees + title. Frontmatter
   `meeting_event_id:` ties the note to the event.
6. **Cache is rebuildable.** Deleting the
   `.coxinha/calendar/` folder forces a re-sync on next
   poll without data loss.
7. **Offline read.** No network? Agenda still renders from
   the cached events, with a small "offline" indicator in
   the provider's chip row.
8. **Keyboard nav** works (←/→, Ctrl+←/→).
9. **Perf:** a 90-day event cache (typical busy calendar)
   renders the strip + events row in under 80 ms.

## Design notes

- **Agenda strip** is a horizontally-scrollable flex
  container. Days are 40 px wide buttons. Today is
  highlighted with Coxinha Orange border-bottom (2 px) —
  one of the rare orange signal uses.
- **Density dot** is a small circle in the cell, diameter
  scaled logarithmically by `log(wordCount + 1) * 3`. Max
  12 px. Colored Steel Grey; turns Ink Coffee when the day
  has 1+ calendar events.
- **Event chip:** small pill, Stone bg, border Line, radius
  4 px. Time in Geist Mono 11 px, title in Geist 12 px
  truncated to 32 chars. Attendee avatars are circles with
  initials (derived from `@handle` fallback).
- **Backend commands:**
  - `list_calendar_accounts() -> Vec<CalendarAccount>`
  - `connect_calendar(provider, oauth_code) -> CalendarAccount`
  - `disconnect_calendar(id)`
  - `list_events(start, end) -> Vec<CalendarEvent>`
  - `create_meeting_note_from_event(event_id) -> Note`
- **CalendarEvent type:**
  ```rust
  pub struct CalendarEvent {
      pub id: String,           // provider's event id
      pub provider: String,     // "google" | "outlook" | "ics"
      pub account_id: String,
      pub title: String,
      pub starts_at: DateTime<Utc>,
      pub ends_at: Option<DateTime<Utc>>,
      pub attendees: Vec<Attendee>,
      pub location: Option<String>,
      pub notes_body: Option<String>,
      pub meeting_url: Option<String>,
  }
  ```
- **Meeting note template** (`.coxinha/types/meeting.yml`
  created as part of this spec) pre-fills:
  - Title: event title
  - Frontmatter: `meeting_event_id`, `meeting_provider`,
    `attendees`
  - Body: `## Prep` · `## Notes` · `## Actions` sections

## Open questions

- **First-run UX** — when user connects their first calendar,
  should we prompt to create meeting notes for all past events
  in the last 7 days? Or start from "today onward"? Proposed:
  today onward; past is opt-in.
- **Density dot color** — grey vs orange vs neutral? Per
  DESIGN.md restraint, orange is overuse here. Proposed: grey
  with size-only density, orange for today's dot only.
- **Time zone ambiguity** — an event shows in the user's
  locale; what if the user is traveling? Proposed: fall back
  to OS timezone; Settings can override.
- **Multi-calendar overlap** — two accounts both syncing,
  same-titled event (e.g., personal cal + work cal both
  have "Dentist"). Dedup by `starts_at + ends_at + title`?
  Proposed: no dedup in F2 — show both **without colour
  differentiation** (respects DESIGN.md orange-only rule).
  Provider shown only as a small icon or on chip hover.

## Test plan summary

- **Rust unit**: .ics parser round-trip, provider trait
  (Google, Outlook, ICS), cache read/write.
- **Rust integration**: fake OAuth server returns fixture
  event list, assert cache file written.
- **Vitest**: agenda strip render with density dots,
  event chip click opens meeting note.
- **Perf**: 90-day cache render budget.
