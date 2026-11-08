# 0109 — Transcript reader

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

The owner revisits past meetings to look up what was said. The meeting
page's Transcrição tab opened with processing controls (model configuration
file, advanced JSON, "Processar gravação", job states, engine warnings) and
put a correction textarea and a save button under every line, so the text
itself was the hardest thing to read.

## Non-goals

- Changing how transcripts are produced, stored or corrected
  (`library.editSegment` and the job model stay as they are).
- The people view of the same panel (spec 0060 and later keep it).

## Design

### P1 Reading first

- With a report, the tab shows a compact header (speakers count and length;
  the version selector only when more than one job succeeded), a
  "Buscar na transcrição" field, then the lines.
- Consecutive lines of the same speaker on the same track form one turn under
  the speaker's name, like a chat. The name is the confirmed person, else the
  lane label used by the speaker lanes ("Falante 3"), else the anonymous
  label. A dot uses the lane colour; a hollow ring marks a voice nobody has
  confirmed yet.
- Each line starts with its time, a button that seeks the audio ("Ouvir a
  partir de 0:44, Rosana Costa").
- A corrected line shows the correction; "corrigido" expands to the original.

### P2 Find in transcript

- Matching ignores case and accents, runs over what the reader shows
  (corrections included) and highlights every match; the current one is
  outlined and scrolled into view. "n/m" with previous/next buttons, Enter and
  Shift+Enter.

### P3 Correcting one line

- A "Corrigir" icon button per line (shown on hover and keyboard focus) opens
  a textarea for that line only, prefilled with what the line shows, with
  Salvar and Cancelar; Escape cancels. A failed save keeps the draft open and
  shows the error above the lines.

### P4 Processing out of the way

- Everything about producing the transcript (notice, configuration file,
  advanced configuration, process/retry, job states and attempts, engine
  warnings, the calibration note) lives in a "Processamento" disclosure at the
  end: collapsed when a transcript exists, open while there is none.
- The "processing in progress" status and processing errors stay visible
  above the transcript.

## Acceptance

- [x] Folding search, non-overlapping ranges, grouping by speaker and track,
      matches over corrections (`transcriptReader` tests).
- [x] Speaker turns, seek by time, find with count, navigation and current
      highlight, one-line correction with cancel and save, processing open or
      collapsed by report presence (`TranscriptReader` tests).
- [x] Existing processing, version and correction behaviour still covered
      (`ProcessingPanel`, `ProcessingPanel.states`, `RecordingDetail.speakers`
      tests).
- [ ] Owner: a past meeting's transcript reads and searches comfortably in
      the app.
