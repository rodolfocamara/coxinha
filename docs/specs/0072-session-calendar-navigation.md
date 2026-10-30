# Spec 0072: Dated meeting navigation and transcript calendar

- Status: in progress.
- Phase: local desktop meeting workspace usability.
- Why: the flat session list obscures dates and transcription coverage, and the
  activity map needs an explicit navigation item.
- Non-goals: Graph occurrence binding, OAuth/consent changes, automatic capture,
  inference, background action extraction, schema migrations or note persistence changes.

## Interaction contract

Keep the established brand, collapsible sidebar, theme, native chrome and activity
map. Add persistent Activities and Calendar navigation entries. Sessions remain
directly accessible in the sidebar, grouped by local calendar date with a compact
period filter: all, today, this week, this month, last 30 days and custom dates.
Preserve the selection when navigating into a session and back. Include an
explicit undated group; never pretend a manual session's creation timestamp is
its scheduled start. For recorded sessions with no scheduled start, use the
recording creation instant, visibly described as a recording date.

Calendar is a local session view, separate from the existing Outlook connection
utility. Provide month navigation, Today, month grid and a readable agenda/list
alternative, a selected-day list, and text/icon indicators and filters for with
and without transcript. A recording or a succeeded generic job alone is not
proof of transcript availability. Empty output and unavailable status must be
distinguished; active/failed processing must not hide an earlier saved transcript.
Keep undated sessions discoverable outside the month grid. Buttons open the
existing session workspace; no action starts capture or sync on view.

Month navigation and date filtering use local civil days, not UTC slicing or
fixed 24-hour offsets. An inclusive end date means the next local midnight as an
exclusive upper bound. Validate impossible/reversed custom dates and preserve
the user's last valid filter. Use app locale for dates and all UI copy. Provide
keyboard focus, names, text beyond color, dark/light tokens and usable 800px layout.

## R2 navigation and density semantics

Previous/next month and Today change only the viewed month and selected day; they
never replace the applied period or transcript filter. Applying a valid period
aligns the viewed month to its first civil day; All aligns to today. The agenda
list shows all dated matches in the applied period, independently of the viewed
month. A month with no matching dated meetings has an explicit status, including
matches outside that month, and a Go to period / Reset filters action. Today can
remain excluded by a custom period, with an explicit day/filter explanation.

Only recording.createdAt accepts the exact SQLite CURRENT_TIMESTAMP format
YYYY-MM-DD HH:MM:SS as UTC, reflecting meeting.created_at's actual schema default.
Scheduled starts_at continues to require an explicit offset; no date-only or
ambiguous local timestamp inference is allowed. Calendar and time fields must be
valid before normalization. Weeks continue to start Monday in this increment.
Invalid programmatic custom ranges match no dated meetings.

The sidebar uses two visual lines per session: title, then local short time and
status icons with accessible text/tooltips. Recording-date fallback stays visibly
labelled; failures remain discoverable. Group headings use Today, Yesterday or a
localized short date, retaining a full accessible date. Calendar explanations are
in a single keyboard-accessible Help disclosure. Compact month cells keep full
coverage labels. The selected day opens beside the grid only when its content
container is sufficiently wide; otherwise selection focuses and scrolls to the
labelled day section. A skip link bypasses the native table's day buttons.

For this increment, Outlook events remain in the existing explicit connection/
sync utility, linked from Calendar. Do not silently equate an Outlook event with
a local session by title or nearby time, and do not imply unlinked provider events
have local transcript coverage.

## Read-only transcript projection

Add optional IPC field `transcript_status` on session list/detail, values
`available`, `none`, `empty`, `unavailable`. The backend derives it from the same
latest successful processing result used by the transcript view, independently
of the latest job state. Nonempty transcript output is available, an empty
successful result is empty, absence is none, malformed/unreadable result is
unavailable. Missing field in old fixtures/IPC is unknown to the frontend, never
assumed available or conclusively absent. No private voice/profile fields leave
the backend. Avoid raw-audio hashing, inference and per-session full report IPC.

## References consulted on Mobbin

- [Lightfield dated meeting list](https://mobbin.com/screens/e17c9497-1d92-4805-94b0-48addf4289b3): date headings and compact date filters.
- [Skiff month calendar](https://mobbin.com/screens/250c15c8-1605-492c-a3ab-bd56c165b80c): Today/month navigation and restrained grid.
- [Calendly meeting agenda](https://mobbin.com/screens/48599d7e-cae2-443e-a3a3-c011e535f1d3): readable daily groups and direct detail access.

Use Coxinha's tokens and components, not reference branding or copied assets.

## Acceptance evidence required

Tests for local midnight/offsets, leap/month/year boundaries, DST civil-day ranges,
custom ranges, undated/recorded fallback, filter retention and stable session IDs.
Backend fixtures must prove no job, generic job, empty result, actual transcript,
new failed/running job after an older transcript and malformed result. UI covers
navigation, filtering, empty/error/retry and unknown-vs-none status. Browser checks
use real app components with synthetic public sessions at 800px and desktop widths;
native build/window and user data acceptance remain separate. Preserve existing
dirty tree, launcher, snapshots and data until reviewed integration is ready.

## Backend review limits

Coverage currently summarizes the persisted machine result before human text
corrections. A whitespace-only result with a later human correction can remain
`empty`; the session and its transcript remain openable. This is a known edge case,
not a reason to hide the session or discard corrections.

The R1 read-only batch reparses latest result JSON at each list refresh. Independent
synthetic measurement (200 meetings, 400,000 segments, 75 MB JSON) was about 118 ms
in release and 1.08 s in debug. This is not a large-library performance acceptance.
A version-aware derived cache is a future optimization; it must invalidate on
changed successful result identity and never become canonical data.
