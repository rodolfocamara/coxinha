# 0120 — Voices from confirmations, and noise kept out of naming

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

The owner named 19 speakers across 5 meetings, yet the private library
holds no voice sample and no embedding space, while the processing runs kept
thousands of private turn embeddings for those very speakers. Naming called
`confirmSpeaker(…, enroll = false)`: samples only came from the separate
"remember this voice" panel (specs 0077 and 0110), which the owner never
opened. The Pessoas screen therefore shows nobody's voice, and recognition
has nothing to compare against.

The backend also refused confirmation with enrollment while processing ran
or a capture was active, and the review was disabled during any capture.
The owner names speakers while the next call is already recording.

While naming, the owner also sees "speakers" that are not participants: the
owner's own room and parallel meetings nearby picked up by the microphone,
and short noise clusters.

## Non-goals

- Automatic naming. A voice is still named only by the owner's confirmation
  (spec 0060); recognition stays a suggestion.
- Calibration or thresholds for recognition. Only sample collection changes.
- Measuring acoustic purity. A sample is structurally eligible (no same-track
  overlap, valid embedding and provenance), not certified clean.
- Deleting transcript text. Folding or excluding a speaker only changes the
  naming screen and sample collection.

## Design

### P1 Confirming remembers the voice

This supersedes, for confirmation, the rule of specs 0077 and 0110 that
enrollment is a separate opt-in step. Naming a speaker is the owner's
statement that the voice belongs to that person; remembering it from the
same gesture is what the owner asked for. Consent and revocation stay as in
spec 0078: every sample keeps its meeting, track, interval, audio checksum,
device and the confirmation that produced it, stays local in the private
database, and can be forgotten one by one or as a whole voice (P4).

- `library_confirm_speaker` only records the decision. It never fails
  because processing or a capture is running; the `enroll` argument is kept
  for compatibility and ignored.
- A confirmed assignment whose revision has no enrollment record is pending.
  The library worker remembers pending voices once it is idle (no capture,
  no local processing), one meeting at a time. The queue is that query, so a
  restart loses nothing.
- Remembering picks the speaker's eligible turns on its track (the
  structural rules of spec 0078), longest first, at most 16 per
  confirmation, each at least 1 s. In the owner's library this gives 16.4 s
  to 155.5 s per confirmed speaker (all eligible speech when a speaker has
  fewer than 16 turns), and keeps 20 people over 10 meetings under the
  4096-sample inventory budget.
- The raw tracks are hashed on a helper thread, so the worker never blocks
  on audio IO. The inserts run on the worker in one transaction, after
  checking the manifest still equals the hashed one (every in-app change to
  raw tracks rewrites the manifest checksum).
- Each outcome is recorded per assignment revision: `enrolled` with its
  sample count, or `failed` with the reason. A failure keeps the
  confirmation, shows on the speaker row with "Tentar de novo", and is not
  retried by itself. A correction to another person is a new revision and is
  remembered again.

### P2 Backfill

- The same queue covers confirmations made before this spec: they have no
  enrollment record, so each is remembered once when the library is idle
  after startup. A confirmation that already had active samples is recorded
  as enrolled without adding more. Running it again changes nothing.

### P3 Visible state, and refresh

- `library_status` carries `voices.generation`, which grows after each
  remembered batch; the change raises `capture-changed`. The speaker review
  and Pessoas reload on it.
- A named row shows "Voz memorizada · N amostras", "Vou memorizar a voz
  quando o Coxinha estiver livre" or the failure.

### P4 Pessoas: one voice across meetings

Pessoas already lists each person's samples across meetings (count,
meetings, play, forget one sample). This spec adds:

- "Esquecer a voz": revokes every active sample of the person with the
  owner's reason and turns voice memory off for that person, so later
  confirmations do not remember it again. "Lembrar a voz de novo" turns it
  back on and lets the person's past confirmations be remembered again.
- Pending and failed confirmations of the person, and the reload after a
  deferred batch.

### P5 Noise and room bleed are folded

Measured on the owner's library on 2026-11-03 (14 processed meetings, 76
named speaker clusters, 19 confirmed by the owner), read-only:

- The smallest participant the owner confirmed spoke 16.4 s, 5.1 % of its
  track. Clusters the owner left unnamed in the same meetings sit at
  13.0–28.1 s and 0.4–1.1 %.
- A cluster is *brief* when its speech is under 15 s, or under 1 % of all
  speech on its track (including overlapped speech).
- On the microphone, every second cluster in five meetings was 25.0–28.0 dB
  quieter than the dominant microphone speaker (median RMS of the centre
  2 s of up to 24 turns): the owner's room and parallel meetings. The one
  exception, a voice 2.9 dB below the owner, is a real voice near the
  microphone. A microphone cluster at least 15 dB quieter than the dominant
  one is *bleed*.
- With these thresholds 23 of the 76 clusters fold (19 brief, 4 bleed only)
  and none of the 19 confirmed ones does. A confirmed speaker is never
  folded.
- Folded clusters go into one collapsed "Ruído ou pouca fala" group under
  the list, with the same rows, so any of them can still be named. The
  header counts only the unfolded voices.
- `library_speaker_levels` reads the microphone levels on demand; until
  they arrive, or when the audio is unavailable, only the brief rule
  applies.

### P6 "Não é participante"

- Every row has "Não é participante". It records the assignment as
  `rejected` without a person, with the owner's origin. The speaker leaves
  the naming list for a collapsed "Não são participantes" group with
  "Desfazer", which revokes that decision. A rejected speaker is never
  remembered; samples of an earlier confirmation stop counting, as for any
  decision (spec 0078).
- On a named row the action sits behind "Trocar" and needs a reason, like a
  correction.

## Acceptance

- [x] Confirming records the decision during a capture or processing and
      enrolls nothing synchronously (`library::voices` tests
      `confirmation_never_waits_for_an_idle_library`).
- [x] An idle library remembers pending voices once, longest eligible turns
      first, capped, with provenance of the confirmation; a second pass adds
      nothing (`curation::tests::remembered`
      `remembers_the_longest_eligible_turns_once`).
- [x] A confirmation that already had samples is recorded without new ones;
      a failure is recorded, visible and retryable; a correction is
      remembered again (`remembered` tests).
- [x] Forgetting a voice revokes its samples and stops later confirmations;
      remembering again re-queues them (`remembered` tests
      `forgetting_a_voice_stops_remembering_it`).
- [x] "Não é participante" rejects without a person, is never remembered and
      is reversible (`remembered` tests `a_rejected_speaker_is_never_remembered`).
- [x] Microphone levels are the median of the turns' centre windows
      (`curation::levels` tests).
- [x] Brief and bleed thresholds, confirmed speakers never folded
      (`speakerNoise.test.ts`).
- [x] The review folds noise, marks and restores non-participants, shows the
      voice state and retries a failure (`SpeakerReview.noise.test.tsx`).
- [x] Confirmation no longer asks to enroll and works during a capture
      (`SpeakerCard.confirmation.test.tsx`).
- [x] Pessoas forgets and restores a voice and reloads after a deferred
      batch (`VoiceMemory.test.tsx`).
- [ ] Owner: the 19 confirmed speakers show samples in Pessoas after the
      next idle start, and the room voices sit under "Ruído ou pouca fala".
