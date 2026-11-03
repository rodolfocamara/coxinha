# 0122 — Universal search

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

The owner: "the search bar has to be universal across the whole system, not
only inside meetings." Today there are two searches that overlap and neither
covers everything:

- The Reuniões toolbar searches meetings (titles, people, notes, summaries,
  transcripts) through `library_search` (spec 0107) and replaces the
  calendar with its own result list. Nothing outside Reuniões can reach it.
- The Ctrl+K palette (spec 0096) lists actions, destinations and note
  titles. It never looks inside a note, a meeting, a transcript or the
  people registry.

A transcript hit only says "transcript"; it cannot take the owner to the
moment it was said.

## Non-goals

- Semantic or embedding search. Matching stays literal, ignoring case and
  accents.
- Searching loose recordings without a session, board areas or files
  attached to items.
- Filters (period, person, category). The palette ranks instead; the
  calendar itself still filters by category.
- Any network call. Search reads only local indexes and files.

## Design

### P1 One search, everywhere

- The recorder strip (the window's title bar) carries a search field on
  every screen: "Search everything" with its shortcut. Clicking it, the rail's
  Search item, Ctrl+K (or ⌘K) and Ctrl+P open the same palette. Ctrl+K is
  in-app only; no global shortcut uses it.
- The Reuniões toolbar search becomes a button with the same label that
  opens the palette. Its result list, filters and time groups are removed,
  so there is one way to search.
- In-view finders stay: find-in-transcript (spec 0109) and the People list
  filter only narrow what one screen already shows.

### P2 What the palette finds

With text typed, the palette lists, after matching actions and
destinations:

| Kind | Matches | Opens |
| --- | --- | --- |
| Notes | title and body (FTS5 index, word prefixes) | the note in the Workspace |
| Meetings | title, invitees and organizer, the owner's notes, summary, category; date shown | the meeting page |
| Transcripts | the first transcript line that matches, with its time | the meeting's transcript, found and scrolled to that line |
| People | name and aliases in the people registry | the person in Pessoas |

- Board activities are notes; they appear under Notes marked as activity.
- Meeting notes (`notes/session-*`) appear under their meeting, not twice.
- Outlook-only events (no session of their own) match on the local
  calendar cache: title, invitees, organizer and categories.

### P3 Ranking and grouping

- Each result gets a tier: 0 the title or name starts with the query,
  1 contains it, 2 a person, alias or category, 3 body, notes or summary,
  4 transcript.
- Inside a kind, results sort by tier; meetings then by closeness to now,
  notes by the index's BM25 rank, people by name.
- Kinds are ordered by their best tier, ties in the order of the table.
- Every kind shows at most 6 results; the backend returns at most 20 per
  kind.

### P4 Responsive on a large vault

- Typing is debounced (200 ms); titles of notes already loaded answer at
  once, before the backend.
- One backend command, `universal_search`, runs off the UI thread and
  answers notes, meetings, events and people together. It replaces
  `library_search`; the CLI `search` keeps its own entry point. A newer
  query makes the one still scanning stop at its next meeting, so fast
  typing never queues scans.
- Fewer than two characters search only actions, destinations and note
  titles.

### P5 Keyboard and screen readers

- The input is a combobox controlling a listbox; ↑/↓ move the active
  option (`aria-activedescendant`), Enter opens it, Esc closes and returns
  focus where it was. Each kind is a labelled group; the result count is
  announced politely.
- Every string is in `en.json` and `pt-BR.json`.

## Acceptance

- [x] Notes match by title and body with word prefixes, ranked title first,
      bounded by the limit, without meeting notes; activities are marked
      (`cli::universal::tests::notes_rank_titles_first_and_respect_the_limit`).
- [x] Meetings rank title before people and category before notes before
      transcript, and the transcript match carries the line's time
      (`cli::universal::tests::meetings_rank_by_field_and_transcript_has_time`).
- [x] Outlook events without a session match on the cache
      (`cli::universal::tests::events_without_a_session_match_on_the_cache`).
- [x] People match by name and alias, name first, bounded
      (`cli::universal::tests::people_match_names_and_aliases`).
- [x] A superseded query stops scanning and returns nothing
      (`cli::universal::tests::a_newer_query_stops_the_scan`).
- [x] Results are grouped by kind, kinds ordered by best tier, at most 6
      per kind, transcripts apart with their time
      (`src/features/search/universalSearch.test.ts`).
- [x] The palette lists the groups, announces the count, moves with ↑/↓,
      opens a note, a meeting, a transcript moment and a person with Enter,
      answers loaded titles before the backend, and Esc closes returning
      focus (`src/features/shell/UniversalSearch.test.tsx`).
- [x] Ctrl+K, ⌘K and the shell's search field open the same palette
      (`src/routes/__root.test.tsx`).
- [x] The Reuniões toolbar opens the universal palette and has no result
      list of its own (`MeetingsHub.peek.test.tsx`, `MeetingsHub.home.test.tsx`).
- [x] The transcript opens found at the searched text and scrolls to it
      (`TranscriptReader.test.tsx`).
- [x] Pessoas opens the person named in `?person=`
      (`PeopleDirectory.test.tsx`).
