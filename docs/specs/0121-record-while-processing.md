# 0121 — Record while the previous meeting is processing

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

The owner, on 2026-11-03: "when I end a meeting and it starts
transcribing, I can't start recording another. The transcribing notice
should be auxiliary, without removing the record button."

After a capture ends, the live transcript drains its tail and then
automatic speaker separation (spec 0099) runs as local processing. While
processing runs:

- the library refuses `Start` ("finish local processing before capture");
- the strip, the rail button, the detected-call prompt and automatic
  recording all refuse or hide the start;
- the strip replaces everything else with the processing line.

A meeting that starts while the previous one is processing is lost.

## Non-goals

- Running speaker separation and a capture at the same time. It is CPU
  heavy and would starve the live transcript of the new meeting.
- Changing the backlog of spec 0098, which already yields to a capture.

## Design

### P1 A capture start is always possible

- `Start` never fails because processing runs. When it does, the job
  yields: it is cancelled at its next checkpoint, its job fails with
  "yielded to a new recording; resumes after it", and nothing it computed
  is published.
- The yielded job restarts with the same configuration once no capture is
  active and the live transcript is idle. The job store already refuses to
  claim local processing while a meeting is recording.
- After a restart of the app the yielded job is not lost: automatic speaker
  separation treats a meeting whose last job yielded as not yet separated.
- Automatic recording (spec 0097) starts the same way; a running processing
  job no longer blocks it.

### P2 The new meeting's live transcript is real time

- The live transcript has one model and one queue (spec 0097 P3). A new
  capture goes to the front of the queue; a previous meeting still draining
  its tail pauses after the window in flight and goes back in the queue,
  keeping its end, and resumes from its last segment after the new
  meeting's drain.
- Chosen over draining both at once: two drains on one model would put the
  new meeting behind by the previous tail, and two models would double the
  memory and the CPU the call needs. Chosen over draining the previous one
  first: its tail can be many minutes behind.

### P3 The strip keeps the record button

- Processing, and a previous meeting's live transcript, show as a secondary
  line in the strip ("Transcrevendo a reunião anterior" and the processing
  phase). The record button stays next to it, and a detected call still
  shows its prompt.

## Acceptance criteria

- [ ] `Start` with processing running yields the job, and the job resumes
  with its configuration once capture and live drain are idle.
  (`library::processing` lifecycle tests)
- [ ] A yielded job is not published and its meeting is picked again by
  automatic speaker separation. (lifecycle and backlog tests)
- [ ] A new capture preempts a draining meeting, which resumes afterwards
  and ends complete. (`coxinha_core::live` worker tests)
- [ ] Automatic recording starts while processing runs.
  (`auto_record::policy` tests)
- [ ] The strip shows processing as a secondary line with the record
  button, and the record actions no longer refuse while processing.
  (`RecorderStrip.test.tsx`, `captureStore.test.tsx`)
- [ ] Owner: a meeting started right after another one ends records, and
  the previous one's speakers appear later.
