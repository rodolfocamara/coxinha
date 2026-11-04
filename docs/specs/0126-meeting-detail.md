# 0126 — Meeting detail as a reading panel

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

The peek of spec 0107 grew through spec 0124 into one flat column of small text.
The owner compared it with Outlook's event form and named the gaps:

- No hierarchy and no clear primary action.
- The invitation preview shows Teams' boilerplate: an underscore line, the join
  link, the meeting ID and the passcode. A passcode has no place in this panel.
- Text touches or is cut at the right edge.
- Invitees are a comma-separated run of names instead of a scannable list.
- Who came and what the meeting produced are buried under the invitees.

The panel answers one question, and the question depends on time. Before a
meeting: can I join, who is coming, am I ready? After it: what came out of it?

## Non-goals

- Accept, decline, event edits or anything else that reaches other people.
- Photos (spec 0117). The avatar accepts one; nothing loads one yet.
- Rebuilding the full meeting page. Only its inspector takes this structure.
- New data. Everything here comes from spec 0124's fields and the same queries.
- Linkifying the invitation text. It stays plain text from other people.

## Design

References are recorded in `docs/design/meeting-detail/README.md`.

### P1 Head

- The head does not scroll: title, time, relative time, then the actions. The
  body scrolls under it, so the main action stays findable at any scroll depth.
- A title longer than four lines is clamped. The full title stays in the
  accessible name and the tooltip.
- The relative time is minutes, hours, days or weeks from now, with `Intl`
  wording in the app's language. A meeting under way says so and how long is left.
- One primary action per state, in this order: join, record, then prepare or open.
  Past meetings lead with "Open meeting". A declined or cancelled event has no
  primary: its join stays reachable as a secondary button, and a declined title
  is struck through as on the calendar.
- "Open in Outlook" is an icon button with a name and a tooltip, next to them.

### P2 Two orders

| Upcoming or under way                                            | Past                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------- |
| My response, location, organizer                                 | What came out: summary or notes, transcript excerpt, facts |
| Who is coming                                                    | Files, references and activities                           |
| Preparation: signals, notes, files, or the "no preparation" mark | Calendar match question (spec 0111)                        |
| Invitation text                                                  | Who came, then who was invited                             |
|                                                                  | Useful or not useful                                       |
|                                                                  | Memory state (spec 0124 P6)                                |
|                                                                  | My response, location, organizer; invitation collapsed     |

- A past meeting with no outcome says so in one sentence instead of leaving a gap.
- A location that only repeats the Teams placeholder is hidden while the join
  button is on screen.

### P3 People

- Invitees are grouped by response, in spec 0124's order and with its rules (rooms
  out, an older cache claims no group). Each row has an avatar, the name, and
  organizer, required or optional. Names wrap and are never cut.
- The section opens with a count line and a proportion bar. The bar is decoration
  over the counts, hidden from screen readers.
- Up to 8 invitees: every group is open. Above that, past meetings start with
  all groups collapsed. Upcoming ones keep "accepted" open when it has at most 8
  people, since that is who is coming. A collapsed group shows up to 4 avatars and
  its count, and its control exposes `aria-expanded`.
- In a past meeting, an invitee who is a confirmed speaker has a check. "Who came"
  keeps spec 0124's rule: confirmed speakers only, never a full attendance.
- `PersonAvatar` shows initials on the stable hue from `hueFor`. It takes an
  optional `photo` for spec 0117 and falls back to initials if the image fails.

### P4 Invitation text

`invitationText` takes the untrusted preview and returns what a person wrote, or
null when nothing is left. It handles pt-BR, English and Spanish wordings, line
endings, a preview Graph flattened into one line, and one cut at its 255-character
limit:

- Underscore separator lines go, wherever they are.
- A Teams heading or a dial-in heading starts a block that runs to the next
  separator or the end of the text.
- A credential label (meeting ID, passcode, password, PIN, conference ID, tenant
  key, video ID) or a Teams link removes the rest of its line, wherever the block
  detection missed it. Text before it on that line stays.
- Footer lines (help, options, privacy, "join on your computer") go.

Nothing is parsed as markup. A passcode never reaches the panel, whichever rule
catches it.

### P5 Signals in the panel

The labelled list stays the legend, with short labels so it wraps cleanly:
"6 speakers, 0 named", "3 follow-ups", "2 files". The long wording of spec 0124 is
its tooltip, and calendar blocks keep it as their accessible names.

### P6 Inspector

`MeetingInspector` takes the same order where it fits: join and Outlook first, then
facts, who came, categories, links, participants (with `PersonAvatar`), invitees
and the invitation. The page's header keeps the primary action, so join is secondary
there.

### P7 Width and type scale

- The panel works from the inspector's 268px up to the peek's 320px. Long words,
  links and labels wrap; buttons in the panel may grow to two lines.
- It must not clip at a larger type scale. New sizes stay in px like the CSS
  around them, so the browser check scales both ways: the root font at 125%, and
  every font size in the panel at 125%.

### P8 Usability checks

`tools/ui-preview/meeting-detail.mjs` opens each state in a real browser with the
mocked IPC and fails on any finding. States: upcoming, under way, past with outcome,
past with only a transcript, past without outcome, 40 invitees, very long title, no
attendees, declined, prepared, calendar match, and the inspector of a past and an
upcoming meeting.

### P9 Property sheet (supersedes the reading order of P2, P3, P5, and P6's order)

The owner, 2026-11-03: "There is still a lot of text in the sheet... If there is
going to be text, we have to organize it more, to make clear what each thing is."
The head of P1 stays. The body becomes labelled rows, one shape for every section:
a fixed label column (icon and short label, muted) and the value beside it.

No sentence stands in for data. Running text is only what the owner wrote or a
model summarized, under a title of its own. A value that is absent is a quiet dash,
and a negative answer recedes in grey.

| Past                                                                                           | Upcoming or under way                                       |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Calendar match, when there is one                                                              | Group "Meeting": response, location, organizer, preparation |
| Group "Result": transcript, speakers, note, summary, follow-ups, files, diagram if any, memory | Group "People": invited                                     |
| Summary or notes, as a titled card                                                             | Invitation (collapsed)                                      |
| Group "People": present, invited                                                               |                                                             |
| Rating, response, location, organizer, invitation (collapsed)                                  |                                                             |

Rules that came with it:

- The Result rows are always the same, in the same order, so the eye learns them.
  An event with no recording shows them as "No" and dashes. "Nothing came out" is
  no longer a sentence, because the rows already say it.
- Transcript: "Yes · 1 h 22" with an action to the full transcript, "In progress",
  "Failed" or "No". The raw excerpt is gone from the panel, so track ids such as
  `output`, `mic` or `speaker-3` cannot reach it.
- Speakers: "6 · none named", with an action to the meeting's naming tab only while
  someone is unnamed.
- Summary: "Yes", "Not yet", or "Off" with an action to the setting.
- Memory: "Yes · summary only", "Not yet" or "No". The exact wording of spec 0124 P6
  stays as the tooltip, so the short value never claims more than that.
- Present: "Unknown", or "3 confirmed" with a disclosure. It keeps spec 0124's rule:
  confirmed speakers only, never a full attendance. The caveat is its tooltip.
- Invited: up to four avatars and how many more, the counts by response (each with
  the dot of its colour on the bar) and the proportion bar. The list opens from this
  row and is collapsed at every size. `groupStartsOpen` now only decides the groups
  inside it. A cache without responses keeps a flat list and claims no group.
- A person carries only the exception: "Organizer" and "Optional". "Required" is
  gone, since nearly everyone is.
- Rating: thumbs as an inline toggle, with the chosen word beside them so the state
  does not rest on a pressed look. The sentence about generated content (spec 0124
  P5) is gone: the Result rows show what was generated, and the mark stays apart.
- Preparation: "Note · 1 file · 1 link", a disclosure with the note's text and the
  items; or "None" with the prepare action. Personal blocks still have no such row.
- A group whose rows are all empty leaves no title behind.
- A Teams placeholder location is also hidden once the meeting is over: there it
  costs a row and says nothing.

The label column is 5.75rem, so labels stay aligned at any font. Long values wrap in
the value column, and a row's action moves to the next line rather than squeezing
it. Below 14.5rem of sheet width (the largest fonts), a label goes over its value.

`MeetingInspector` shares the rows: when, event, audio, transcript and folder become
rows, with what the meeting has, response, location, organizer and invitation under
them; then the People group. It lists only what the meeting has, since it scrolls
with a whole page and has no need of a fixed shape.

## Acceptance

- [x] The preview loses Teams' block in pt-BR, English and Spanish, flattened or
      cut, and never shows a passcode; what a person wrote stays; nothing left means
      no preview (`invitationText.test.ts`, `MeetingDetail.panel.test.tsx`).
- [x] Relative time, panel state, default-open groups and the speakers and memory
      values (`meetingDetail.test.ts`); the location rule (`invitationText.test.ts`).
- [x] Avatar: stable initials and hue, a photo when given, initials when it fails
      (`MeetingDetail.people.test.tsx`).
- [x] Upcoming leads with join as the only primary action, then who is coming and
      preparation (`MeetingDetail.panel.test.tsx`).
- [x] Past leads with the result and "Open meeting", then who came versus who was
      invited and the mark, in that order (`MeetingDetail.past.test.tsx`).
- [x] Declined and cancelled events have no primary action and keep join
      (`MeetingDetail.panel.test.tsx`).
- [x] Rows carry organizer or optional; lists start collapsed with counts; collapse
      controls expose their state; a confirmed speaker is marked
      (`MeetingDetail.people.test.tsx`, `MeetingDetail.panel.test.tsx`).
- [x] Existing capabilities keep working: calendar match, record, prepare, open
      meeting, transcript link, mark, memory and settings link
      (`MeetingsHub.peek.test.tsx`, `MeetingsHub.match.test.tsx`,
      `MeetingsHub.signals.test.tsx`).
- [x] The inspector has join first, the facts, grouped invitees, categories and
      participants (`MeetingsHub.signals.test.tsx`, `MeetingsHub.detail.test.tsx`,
      `MeetingsHub.categories.test.tsx`).
- [x] No horizontal overflow and no text at the edge for every state, in both themes
      and languages, at 320, 300 and 268px, and with type scaled 125% both ways
      (`tools/ui-preview/meeting-detail.mjs`).
- [x] Keyboard: focus lands on the title, tab order follows reading order, every
      control is reached, collapse controls toggle with focus kept, Escape returns
      focus to the block (`tools/ui-preview/meeting-detail.mjs`).
- [x] Time to find: join and the outcome are in view without scrolling at 1280×800
      and 1366×768 (`tools/ui-preview/meeting-detail.mjs`).
- [x] P9: every body line is a labelled row or sits under a title
      (`MeetingDetail.past.test.tsx`, `tools/ui-preview/meeting-detail.mjs` "labels",
      which fails on text outside a row, a row with no label, a raw track id or
      "Required").
- [x] P9: past order, always-present Result rows as dashes, transcript, speakers,
      summary and memory values, and their actions (`MeetingDetail.panel.test.tsx`,
      `MeetingsHub.signals.test.tsx`, `meetingDetail.test.ts`).
- [x] P9: no transcript excerpt and no track id (`MeetingDetail.past.test.tsx`).
- [x] P9: Invited sums up by response, its list starts collapsed even when short, only
      the exception is marked (`MeetingDetail.people.test.tsx`).
- [x] P9: preparation counts open the note and files; invitation collapsed in both
      states (`MeetingDetail.panel.test.tsx`).
- [x] P9: a past meeting with 8 invitees fits at 1280×800 and the default font, in both
      languages (`tools/ui-preview/meeting-detail.mjs` "fit", state `past8`).
- [ ] Owner: read a real week and a real past meeting in the running app.

## Evidence

- Property sheet, before and after: `docs/design/meeting-detail/property-sheet.png`.
  Body scroll height of `past8` at 1280×800, in a 467px body: 1047px (en) and 1064px
  (pt-BR) before, 467px in both after.

- Contact sheet: `docs/design/meeting-detail/contact-sheet.png`; references and
  findings: `docs/design/meeting-detail/README.md`.
- `tools/ui-preview/meeting-detail.mjs`: 11 states and the inspector, in two languages,
  three widths and three type scales, ended with 0 findings. A first pass on the old
  panel (320px, English only) measured 8. Its screenshots show join cut at the bottom
  edge after the invitee list, and the outcome below the fold.
