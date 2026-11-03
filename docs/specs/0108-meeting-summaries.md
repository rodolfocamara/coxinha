# 0108 — Meeting summaries

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

The owner goes back to past meetings mostly to find what was decided and
who does what. Today that means reading the whole transcript. The owner
approved generating a summary after each transcript with the model that
already writes suggested titles (spec 0097 P4, ADR 0024): the owner's own
server, reached over SSH. The calendar redesign (spec 0107) shows the
summary when a past meeting is selected; the CLI (spec 0106) returns it to
the owner's agents.

## Non-goals

- A second model, provider or cloud service. Summaries use the title
  endpoint and nothing else.
- Summarizing live, during the meeting. Only finished transcripts.
- Editing the summary in place. It is Memory (ADR 0015): regenerate it, or
  write in the notes.
- Summaries of notes or files.

## Privacy

Titles send a capped excerpt (ADR 0024 item 1: at most 1500 transcript
tokens per request). A summary needs the whole transcript, so it is its own
opt-in: "Gerar resumos", off by default, only available while the title
model is on, with text that says the whole transcript text goes to the same
server, in parts. Every request still carries at most 1500 transcript
tokens; a long meeting becomes several requests. Nothing else leaves the
computer: no audio, no notes, no files, no participants beyond the speaker
names in the transcript. Logs keep durations and errors, never text.

## Design

### P1 Store (`coxinha-core/src/store/meeting_summary.rs`)

- Library schema version 6 adds `meeting_summary(meeting_id, job_id,
markdown, model, generated_at, source_sha256)`, one row per meeting.
- A meeting needs a summary when its latest successful processing run has
  none, or one written from an older job. A rerun whose transcript hashes
  the same keeps the summary (the row takes the new job); new words write a
  new one.
- The CLI reads the table through its own read-only connection; an older
  library without the table has no summaries.

### P2 Transcript text (`coxinha-core/src/processing/text.rs`)

- The summary reads the same text as the CLI: corrections applied, speaker
  names only when confirmed, `[mm:ss] Name: text`. Its SHA-256 is the
  source hash.

### P3 Generation (`src-tauri/src/summaries/`)

- The transcript is cut into chunks of whole lines within 1500 tokens
  (`titles::chunk_lines`). One chunk: one request. More: one request per
  part for notes, notes merged in groups while they exceed the cap (at most
  four rounds), then one request that writes the summary from the notes.
- Language: Portuguese unless English words clearly dominate. The answer
  has exactly four sections, `## Resumo` (2–3 sentences), `## Decisões`,
  `## Ações` (owner only when said) and `## Pendências` (English headings for
  English meetings), "- Nenhuma" when empty, and nothing invented.
- Transcript and notes are sent fenced as data. The answer is untrusted:
  reasoning blocks, code fences, links, angle brackets and control
  characters are removed, at most 6000 characters, and the app renders it
  as text, never HTML.

### P4 When

- A background loop looks every minute while both settings are on, and
  summarizes every meeting that needs it, newest first, one at a time.
  Failures wait 1, 2, 4… minutes (at most 6 hours) per meeting; the
  transcript is never touched by a failure.
- "Gerar resumo" / "Gerar de novo" on the meeting page runs one now, under
  the same opt-in and the same one-at-a-time rule.

### P5 Where

- `library_meeting_summary { meetingId } -> { markdown, generatedAt } | null`
  and `library_summarize { meetingId }` (same shape).
- Meeting page, Notas tab: a "Resumo" block above the notes with the date it
  was generated and "Gerar de novo"; "Gerar resumo" while none exists and
  summaries are on; a hint to turn them on otherwise; progress and errors.
  It looks again every 30 s while waiting for the background loop.
- CLI: `meeting <id>` returns `summary`; `search` matches summaries
  (`field: "summary"`).
- Ajustes › Integrações: "Gerar resumos" under the title model card.

## Acceptance

- [x] Candidates after a successful run, staleness by job, retag on the same
      words, migration from version 5, readers without the table
      (`store::meeting_summary` tests).
- [x] The actor offers the newest transcript, skips silent ones and
      meetings waiting a retry, keeps a summary when the words are the same
      (`library::summaries` tests).
- [x] Chunks cover every line within the cap; one request for a short
      transcript; map, bounded reduce and final step for a long one;
      transport errors and unusable answers fail (`titles::excerpt`,
      `summaries::generate` tests).
- [x] Prompts fence the input and ask for the four sections in the right
      language; output cleanup (`summaries::prompt` tests).
- [x] Both settings gate summaries; older settings stay off; retry backoff
      (`summaries` tests).
- [x] CLI returns and searches summaries (`cli::tests`).
- [x] Summary block states and the settings toggle (`SummaryBlock` tests).
- [ ] Owner: a real meeting summarized by the owner's server, read in
      Coxinha and through the skill.

## Evidence

- Rust: `store::meeting_summary::tests` (4), `library::summaries::tests`,
  `summaries::{prompt,generate,tests}`, `titles::excerpt::tests::
chunks_cover_every_line_in_order_within_the_cap`,
  `cli::tests::shows_and_searches_the_generated_summary`.
- Vitest: `SummaryBlock.test.tsx` (4).
