# 0091 — Recording transparency and joint playback

Status: in-progress
Phase: F1
Date: 2026-10-26

## User outcome

Show where local audio is stored, its measured size and recorded duration without
requiring the user to expand capture controls. Listening to a meeting defaults to
one transport for microphone and system audio together. Individual sources remain
available for inspection and speaker curation.

## Contract

- Capture status includes a lightweight file-stat snapshot. No hashing, decoding,
  inference or audio grant is performed by the one-second status poll. Actual WAV
  bytes on disk are not a promise that the last block has been durably checkpointed.
- Show elapsed capture time separately from recorded audio duration (pauses are
  excluded from raw audio). Final duration comes from manifest frames/sample rate;
  live PCM16/48kHz duration comes from actual fixed-header file sizes. Missing or
  inaccessible files show unavailable, never a fabricated zero. Sizes cover audio
  files only, not databases, transcript, models or the whole library.
- Show the local directory and individual file sizes on demand; allow explicit
  path copying. A displayed path is not an audio capability and is never passed to
  the existing audio URL registry. Only known owned regular WAV files are statted.
- The meeting page keeps its summary visible while capture controls/audio details
  are collapsed. A processing phase is separate, with no ETA until the engine
  supplies measured progress. Waiting for metadata is not inference progress.
- One Play/Pause/seek control plays granted tracks together, starting at the same
  recorded-audio offset. No upload, transcoding, full-file decode, persistent mix,
  or raw rewrite. Device latency, drift, echo and independent capture gaps remain
  uncorrected; disclose this instead of claiming wall-clock alignment. Initial
  arrival timestamps are not treated as calibrated device offsets.
- Use the longest media clock as the playback reference; correct player drift,
  stop all on error/buffering, report the condition, and allow explicit retry.
  A shorter track ending must not stop a longer one. Reject late play completions
  after stop, scope change or unmount. Seeking and volume are shared.
- Individual playback and bounded speaker previews are mutually exclusive with
  joint playback. Transcript seeking still reveals/focuses the individual player
  without autoplay. Preserve the existing bounded media-clock player unchanged.
- All labels, errors and controls work in English/pt-BR and with keyboard input.

## Evidence and limits

Test actual temporary WAV stats, missing/symlink boundaries, unknown/partial size,
pause duration distinction, media-clock drift, unequal durations, failed/stale
play promises, seek, buffering, scope cleanup, and transcript/speaker regressions.
DOM tests use synthetic media clocks. Native WebKitGTK/Windows listening and
device alignment remain separate acceptance gates. This increment does not finish
the automatic processing queue or model adapter in specs 0088–0089.
