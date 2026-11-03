# 0124 — Agenda details and meeting signals

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

The owner wants the agenda to answer, without opening Outlook or each meeting:
who confirmed, who came, what is really on the calendar, what a meeting already
has (transcript, note, diagram, preparation), which meetings produced something
and were worth it, and whether anything was kept in memory. This is step 1 of
`docs/research/2026-11-03-outlook-calendar-parity.md`: read what is missing,
send nothing to anyone.

## Non-goals

- Accept, decline, event edits or anything else that reaches other people. The
  slice only reads from Graph and asks for no new scope.
- The coach on the home page. The signals are ready for it; it is not built.
- Turning the summary opt-in on or sending anything to the model.
- Delta queries. The refresh stays a full read of the window.
- Marks on meetings without a session: an Outlook-only past event has nothing
  of the owner's to judge, so it offers no mark.
- Signals for a recording without a session: signals are per session.
- A filter over the signals. The peek's labelled row is the legend.

## Design

### P1 Calendar details

- The sync adds `responseStatus`, `location`, `onlineMeeting`, `bodyPreview`,
  `showAs`, `isOrganizer` and `webLink` to its `$select`; `attendees` already
  carries each status and type. Every new field is optional when parsed: a
  missing or unknown value leaves it empty and never fails the sync. Each new
  field of `Event` has `#[serde(default)]`, so the existing cache still loads.
- Per-attendee responses live in their own `attendeeResponses` list. `attendees`
  keeps its shape because participants, the CLI and auto-record read it, and a
  response must not end up stored as a meeting's participant.
- The window is 30 days back and 180 ahead; the refresh runs every 5 minutes.
- Paging limits hold. The live cache has 202 events in 60 days, about 3.4 a day,
  so 210 days are about 720 events (8 pages of 100). The limits stay at 50 pages
  and 5000 events, about 24 events a day for the whole window.
- Third-party data (body preview, attendees) stays in the local cache and is
  never logged. `Event` has no `Debug`; the CLI keeps printing only names.
- `Calendars.ReadBasic` excludes the body, so a connection holding only that
  scope may read no preview. It was not tried against such an account.

### P2 Peek and meeting page

- For an event, both show: my response; invitees grouped by accepted, tentative,
  declined and no answer, with counts and required vs optional (rooms are left
  out of people counts); location; the body preview as plain text.
- An older cache has names without responses: the flat list stays and no group
  claims "no answer" until the next sync.
- "Join in Teams" appears until the meeting ends. The URL is untrusted: only
  `https` on `teams.microsoft.com`, `teams.live.com` or `teams.cloud.microsoft`,
  without credentials or a custom port, is accepted, when parsed and again when
  opened. The window sends only the event id; the backend opens the link through
  the same opener as item references.
- "Open in Outlook" uses the current format from the Graph docs,
  `https://outlook.office365.com/calendar/item/{url-encoded id}`, or
  `outlook.live.com` when Graph's `webLink` says the account is personal, because
  `webLink` itself only opens earlier versions of Outlook on the web.
- "Who came" reads confirmed speakers of the recording, apart from who was
  invited and labelled as such. Someone silent or unnamed is not listed, so it
  never reads as a full attendance list; without a recording nothing is claimed.

### P3 Block style follows Outlook

- Declined is dimmed with a struck-through title, tentative is hatched and free
  is outlined; declined wins over tentative, and tentative over free. The state
  is also in the accessible name, never only in the style.
- Dimming mixes the fill towards the page instead of using opacity. Hatching goes
  away from the text colour (dark stripes in the dark theme, light in the light
  theme), so contrast can only rise. The palette test enforces both.

### P4 Signals

`library_meeting_signals` returns `{ summariesOn, sessions: [...] }` and is the one
place to read them; `signals::collect` is the same answer for any Rust caller, and
`useMeetingSignals` for the UI.

| Signal | Means |
| --- | --- |
| `transcript` | The latest successful run has spoken text |
| `speakers` | Named and unnamed speakers, counted like the page's lanes (`unknown` is not a speaker) |
| `note` | The session note has a letter or digit after its frontmatter |
| `preparation` | See below |
| `diagram` | See below |
| `summary` | A `meeting_summary` row exists |
| `followUps` | `linked` activities, plus `actions` counted from the summary's actions section |
| `generatedContent` | `summary`, any follow-up, `diagram` or `note` |
| `mark` | The owner's mark (P5) |

Preparation means a non-blank note, an item-folder file or a reference from
before the scheduled start:

- A reference has `addedAt`. A file has its modification time. A note has only its
  modification time, as the frontmatter holds no edit date.
- So a note edited during or after the meeting does not count, even if it also
  held earlier text: there is no way to tell, and the signal never claims
  preparation without evidence. The same goes for a missing or unreadable
  timestamp, and for a session without a start.
- A linked activity is a follow-up, not preparation.

Diagrams, from what exists in the code: there is no Excalidraw or Mermaid
integration (spec 0012 is a draft); a diagram is a file someone added to the item
folder. The other canvas is the Board. `diagram` is true for:

- A file or reference ending in `.excalidraw`, `.excalidraw.json`, `.drawio`,
  `.mmd` or `.mermaid`, or a link to `excalidraw.com` or `app.diagrams.net`.
- The meeting's own note placed on the Board. A linked activity on the Board does
  not count: every activity is a Board card, so it would say nothing.

Cost, since the agenda polls this every minute:

- It runs on a blocking thread with read-only connections, not on the library
  actor, so a poll never waits for or delays capture.
- A job's result is immutable once it succeeded, so it is parsed once and kept
  in memory by job id.
- At most 2000 sessions, the first 64 KB of each note, 500 entries per item
  folder. Folders, links and the Board are read once per call, not per session.

Rendering:

- Week blocks show icons from 60 minutes up and none below, never clipped. Icons
  that do not fit the width wrap out of view whole. The accessible name keeps
  all of them at any size. Rows and the peek show them too; the peek with labels.
- A future meeting without preparation shows a subtle "no preparation" mark. A
  block that is not really a meeting to prepare for shows no such mark: all-day,
  cancelled, declined, free or without invitees (spec 0100's personal blocks).

### P5 Useful or not

- The peek of a past session has "Útil" and "Não foi útil", toggle buttons; a
  second click clears the mark. It is stored in `meeting-marks.json` next to the
  library with `settings_file`, without a schema migration. It is shown among the
  icons, and follows the recording when spec 0115 P3 joins a session into its
  prepared one.
- "Generated content" is derived from P4 and stated apart. Nothing derives
  usefulness: useful is only the owner's mark.

### P6 What "in memory" covers today

ADR 0015 defines Memory as AI-derived, labelled and dismissible. Verified in the
code on 2026-11-03:

- A meeting's memory icon means its `meeting_summary` row exists, and only that.
  The row names the job and transcript hash it came from. The app labels it as
  generated, and it can be regenerated but not yet dismissed, a gap against the
  ADR.
- Not covered by the icon: the transcript, notes and files. They are Knowledge,
  searched by the app and the CLI whether or not summaries are on.
- Not covered either: voices remembered from confirmations (spec 0120) and title
  suggestions (spec 0097), which are separate stores with their own controls.
- It does not exist: `.coxinha/memory/`, extracted facts or preferences, meeting
  embeddings. Nothing reads across meetings to learn from them.

The peek of a past meeting says which case applies. With summaries off it says
the meeting is not in memory and links to Ajustes › Integrações. With summaries on
it says the summary is still to come, or that a transcript is missing. This slice
neither changes the opt-in nor calls the model.

## Acceptance

- [x] New fields parsed; missing or unknown values stay empty; the old cache loads
      (`calendar::details` tests `reads_the_details_outlook_has`,
      `missing_or_unknown_details_stay_empty`,
      `a_cache_from_before_this_spec_still_loads`).
- [x] Window and refresh interval; paging limits cover the wider window
      (`calendar::graph_tests::the_window_reads_30_days_back_and_180_ahead`,
      `paging_limits_hold_for_the_wider_window`,
      `calendar::background` test `refreshes_every_five_minutes`).
- [x] Only Teams URLs over https are accepted, and the Outlook link is the current
      format with an encoded id (`calendar::details` tests
      `only_teams_urls_over_https_are_accepted`, `outlook_link_uses_the_current_format`).
- [x] Peek and page show response, grouped invitees with counts, location, buttons
      that send only the event id, and the preview as text; an older cache claims
      no group (`eventDetails.test.ts`, `MeetingsHub.signals.test.tsx`).
- [x] Who came lists confirmed speakers apart, and is absent without them
      (`MeetingsHub.signals.test.tsx`).
- [x] Block styles and accessible names; contrast holds
      (`MeetingsHub.signals.test.tsx`, `categories.palette.test.ts`).
- [x] Each signal, preparation by timestamp, diagrams and the bounded reads
      (`signals::tests`), action items from the summary section
      (`summaries::prompt_tests::counts_action_items_of_the_section`).
- [x] Icons on tall blocks, none on short ones, rows and peek; the mark for a
      future meeting without preparation (`meetingSignals.test.ts`,
      `MeetingsHub.signals.test.tsx`).
- [x] The mark is reversible, stored per session and follows a joined session
      (`signals::marks` tests, `library::absorb` test
      `a_joined_session_keeps_its_mark`, `MeetingsHub.signals.test.tsx`).
- [x] Generated content never reads as useful, and the peek states memory honestly
      with the settings link (`signals::tests`, `MeetingsHub.signals.test.tsx`).
- [ ] Owner: on real data the responses match Outlook, "Join in Teams" joins, "Open
      in Outlook" opens the event (not checked with `ImmutableId` values against a
      live mailbox), and the icons read well on a real week.
