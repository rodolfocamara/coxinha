# 0101 — Offline speaker clustering and per-word attribution

Status: in-progress (implemented and accepted on the owner's library; awaiting merge)
Phase: F1
Date: 2026-11-02

## Why

The first automatic separation of a real meeting (spec 0099) labelled 137
speakers in a 27-minute call with about 7 people, and left 77% of the text
without a speaker. Two causes:

- clustering was online "first seen leads": the first embedding of a voice
  became its fixed centroid and a turn joined only above cosine 0.75. Turns
  are short (median 1.8 s), so the same person rarely reached it and each
  turn opened a new identity or became unknown;
- the overlap rule abstains on a whole segment when any unknown turn
  touches it, and word segments were also cut at every unlabelled gap.

## Design

### P1 Average-linkage clustering per track (`speech/clustering.rs`)

- The diarizer collects every turn of a track, then clusters all embeddings
  at once: average linkage over cosine distance by nearest-neighbour chain
  (O(n²)), cut at `cluster_distance_threshold` (0.7).
- Clusters with less than `minimum_cluster_seconds` (10 s) of speech are not
  identities: each of their turns joins the large cluster whose centroid is
  within `cluster_reassign_distance` (0.5), else stays unknown. The largest
  cluster always stands, so a short meeting keeps its voice.
- Labels stay unique across tracks and follow first appearance.
- `IMPLEMENTATION_VERSION` becomes `local-processing-v3-…-ahc`;
  `cluster_cosine_threshold` and `cluster_margin` are no longer read.

### P2 Per-word attribution of the live transcript

- Each word takes the labelled turn under its midpoint. Unlabelled words
  (short or overlapped speech) stay in the running segment; segments split
  at a change of labelled speaker, a pause over 800 ms or 15 s.
- A segment is attributed when labelled words cover at least half of its
  word time. Lines without word timings keep the overlap rule.

### P3 Redo superseded automatic runs

- Automatic runs use engine `coxinha-local-cpu-v3-live`. The backlog
  separates again a meeting whose runs are all automatic and older; a run
  configured by hand, or a current one even if failed, is left alone.

## Evidence (owner's library, CPU)

| Meeting | Before: speakers / text without speaker | After |
|---|---|---|
| 30/10, 27 min, ~7 people | output 137 / 77% | output 6 / 4%, mic 1 |
| 29/10, 30 min, 2 invitees | not measured | output 2 / 12%, mic 1 / 6% |
| 29/10, 1h49, 18 invitees | not measured | output 7 main voices / 17% |
| 26/10, 1h46 | not measured | output 1 main and 3 small voices / 28% |

The 6 and 2 output voices hold from distance 0.6 to 0.75 on both meetings,
so 0.7 sits on a plateau, not on an edge.

## Acceptance

- [x] Clustering groups noisy turns of one voice, keeps voices apart,
      reassigns or abstains for small clusters (`speech::clustering` tests).
- [x] Unknown short turns neither split nor unlabel speech
      (`speech::live_words` tests).
- [x] Only older automatic runs are redone (`speech_models` tests).
- [x] Owner's library separated again with the new engine: 8 automatic
      runs succeeded on `coxinha-local-cpu-v3-live`, none failed.
