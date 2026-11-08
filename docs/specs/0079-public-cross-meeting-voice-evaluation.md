# 0079: Public cross-meeting voice evaluation

Status: evaluated with bounded real-public-data evidence; evaluation-only, no production policy.

## Scope

A bounded isolated harness measures pinned local WeSpeaker embeddings across
separate AMI meeting sessions. Only public corpus audio and annotations may be
read; no operator library, desktop data, HOME, credentials or keyring. Existing
production recognition remains unknown without a policy. No production source,
CLI, Cargo workspace, frontend, README, consent or policy installation changes.

## Frozen protocol

Before test inference/scoring, persist and hash criteria, corpus split manifest,
model/runtime hashes and exact preprocessing source snapshot. Enrollment uses
ES2004a, calibration ES2004b, test ES2004c/d. Participant identity comes from AMI
annotation metadata, never headset channel or session-local label. Unknown
calibration and test people come from different series and must have disjoint
participant IDs. Select the first two annotation-clean >=4-second intervals per
participant/session, subtracting other participants' speech intervals; selection
must not inspect embedding scores. Source intervals and sessions are disjoint.
Use HTTP byte ranges for PCM excerpts where verified, cap cache/downloads at
approximately 1 GiB. Preserve source URLs, range headers, dates, hashes, licenses,
channel mappings, annotation identity evidence and all transformations.

## Evaluation

Two enrollment examples per known person; maximum cosine over those examples
per identity. Calibration only sweeps cosine threshold and best/runner-up margin;
freeze deterministic candidate before held-out test scoring. Report pairwise
same/cross distributions, per-query maxima/margins, known false rejection and
misidentification, unknown false acceptance/rejection, coverage, counts and
small-sample uncertainty. Silent/mixed controls are separate from clean acoustic
proof. If segmentation is probed, report coverage and cluster fragmentation
separately; oracle excerpts do not prove diarization or general identity quality.
English, same-day simulated AMI meetings and headsets cannot establish universal
PT-BR/Teams/microphone performance. Every output is evaluation_only, regardless
of small-corpus results. No installer or automatic activation is provided.

## Acceptance

- Real local model scores on annotation-verified recurring people in disjoint
  recordings, plus held-out unknown people; or executable bounded failure probe.
- Criteria/splits/models frozen before test scores, candidate frozen on calibration.
- Tests reject split/person leakage, duplicate source content, corrupted hashes,
  incompatible model/preprocessing, and nondeterministic criteria selection.
- Synthetic harness tests are explicitly not acoustic evidence.
- English report, machine-readable evidence/provenance, exact commands, bytes,
  license, baseline/delta and remaining gates under
  target/speaker-workspace-20261025/evaluation-r1.

## Executed R1 evidence (2026-10-25)

- 48 real AMI 4-second clips, 8 enrolled, 16 calibration, 24 held out.
- Annotation global IDs verify four recurring people across ES2004a/b/c/d;
  calibration unknowns ES2005b and test unknowns ES2006a are person-disjoint.
- Frozen calibration-only candidate cosine >=0.54 and strict margin >0.20.
- Held-out: 15/16 known accepted correctly, one false rejection, zero wrong-person
  acceptance; 8/8 unknown clips rejected. Only four independent test unknowns.
- Copied production segmentation produced 6/7 clusters for four people in
  constructed real-speech assemblies, including a mixed-identity cluster.
- Fourteen synthetic contract tests passed; separate current-core copied-library
  probe with real embeddings confirms match and recognition unknown without a
  policy. Final frozen-input/model/audio/split integrity audit passed.
- Production adequacy gates remain unmet. No policy installed or installer added.
- Full English report: target/speaker-workspace-20261025/evaluation-r1/REPORT.md;
  machine evidence: evidence.json, segmentation-evidence.json,
  no-policy-guard-evidence.json, integrity-audit.json and artifact-manifest.json.
