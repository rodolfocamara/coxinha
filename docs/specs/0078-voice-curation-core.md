# 0078: Bounded private voice curation core and IPC

Status: implementation in progress. Additive increment; no frontend ownership.

## Intent and boundaries

A human can confirm an identity independently, enroll selected structurally eligible
turns against that exact confirmed assignment, inspect private voice memory, and
revoke one sample. Experimental comparison provides manual candidate evidence from
other recordings. It never assigns, preselects, suggests or confirms an identity.
Existing `recognition`, `match_voice`, `library_confirm_speaker` and legacy trackless
assignment revocation retain their contracts. No schema migration, policy installer,
network, provider, calibration algorithm change, or automatic named assignment.
The backend research document is a proposal; its aggregation/exclusivity, acoustic
silence heuristics, migration and decision-log proposals are deliberately excluded.
Diarizer fragments may independently compare to the same person UUID.

## IPC contract

Arguments use Tauri camelCase; responses use camelCase except `space`, whose existing
EmbeddingSpace fields are `model`, `revision`, `model_hash`, `preprocessing`, `dimension`.
All reads are private IPC only, never additions to meeting exports.

- `library_enrollment_candidates(job, track, speaker)` returns
  `{job,meetingId,track,speaker,profileGeneration,assignmentId,personId,
  assignmentRevision,turns:[{turnId,startMs,endMs,eligible,reasons,activeSampleCount}],
  quality:{noise:"unmeasured",echo:"unmeasured",otherTrack:"unmeasured"}}`.
  Assignment fields are nullable. IDs and intervals come from the successful
  canonical processing report, joined by exact job, speaker and turn ID to private
  processed_candidate and exact source meeting, track, interval and manifest hash.
  Reasons: `unknown_speaker`, `missing_embedding`, `invalid_candidate`,
  `provenance_mismatch`, `same_track_overlap`, `already_enrolled`.
  Eligibility is structural, never a claim about clean acoustics. No WAV decode or
  audio hash pass for listing; enrollment verifies source bytes separately.
- `library_enroll_selected_turns(job,track,speaker,assignmentId,personId,turnIds,
  humanOrigin,expectedAssignmentRevision)` returns `{sampleIds,profileGeneration}`. Requires 1..128 unique IDs,
  each eligible and in exact scope, and a current confirmed matching person and
  assignment and expectedAssignmentRevision. Stale list revisions fail before any write. Before/after source verification surrounds one private transaction.
  Any validation, insert or hash failure rolls back the entire selected batch,
  including generation changes. Existing samples and confirmation remain intact.
- `library_voice_profiles()` returns `{profileGeneration,profiles:[{personId,name,
  spaces:[{spaceId,space,activeCount,activeDurationMs}],revokedCount,invalidatedCount}]}`.
  Spaces group compatible embeddings by all five provenance fields. Revoked wins
  over invalidated; active requires matching confirmed assignment/person/revision.
- `library_person_samples(personId)` returns `{profileGeneration,personId,samples:[
  {sampleId,assignmentId,assignmentRevision,currentAssignmentRevision,state,
  spaceId,space,meetingId,track,startMs,endMs,createdAt,revokedAt}]}`.
  `state` is `active`, `revoked` or `invalidated`. Creation dates are SQLite UTC
  timestamps, not recording dates. No raw vectors, device, quality/consent text or
  human origin is projected. Historic revokedAt is null when it was not recorded.
- `library_revoke_voice_sample(personId,sampleId,humanOrigin)` returns null.
  Explicit nonempty human origin is required. Transactionally sets revoked and
  increments generation; it preserves every row. Appends an event with UTC time
  and origin in private provenance_json `curationRevocations`. Existing provenance
  fields and previous events are retained. Legacy `revoke_sample` has no invented
  origin/date/history; repeated explicit revocations append actual events.
- `library_voice_comparison(job)` returns `{job,experimental:true,profileGeneration,
  speakers:[{track,speaker,spaces:[{space,status,candidates:[{personId,name,meanCosine,
  maxCosine,supportTurns,supportDurationMs,activeSamples,turns:[{turnId,startMs,
  endMs,cosine}]}]}]}]}`. Up to three people per compatible space, ranked by the
  arithmetic mean of per-turn maximum sample cosine, then UUID for stable ties.
  Support reports the evaluated turns/durations, not thresholded acceptances or
  confidence. Each person can occur for multiple anonymous labels. All active
  evidence in the same meeting or with any source audio hash in the query manifest
  is excluded, including a duplicate import under another meeting UUID. Invalid
  query candidates are skipped conservatively; corrupted profile rows never
  provide comparison evidence. No policy is installed or consulted here. Status is `candidates`, `no_compatible_history` or `self_excluded` or `no_candidates` for invalid compatible history; each speaker also has `queryStatus` (`eligible` or `no_eligible_turns`). At most 32 turn details per candidate, with `turnDetailsTruncated` explicit; score/support always use every evaluated turn. Invalid rows are counted in `invalidHistorySamples`.

## Bounds and concurrency

Read operations hold a coherent private DB snapshot; selected enrollment uses an
IMMEDIATE private transaction to prevent concurrent correction/revocation races.
Canonical report JSON is limited to 16 MiB and 4096 turns. Private profiles/sample
inventory caps at 4096 rows (error, never silent omission). Comparison caps at 128
eligible query turns, 1024 active source samples, 4096 vector dimensions, and eight
million scalar comparison operations. Limits yield explicit errors rather than
partial rankings. Source hashes are checked only at enrollment batch boundaries.
The single desktop library worker serializes actions; no inference engine or
native app is started by these endpoints.

## Acceptance and evidence

Synthetic library fixtures only. Tests cover exact scope/provenance, overlap vs
nonoverlap, malformed/missing embeddings, duplicate/empty/foreign selections,
transaction rollback and source mutation; inventory revision/revocation counts;
private revocation history through backup and exclusion from exports; compatible
spaces, homonyms, self/duplicate-source exclusion, fragments, immediate correction
and revocation removal, unchanged unknown recognition, and read-only comparison.
Hermetic `--lib` tests and strict clippy run with dedicated build/HOME/XDG roots;
no full Cargo test, native app, operator recordings or calibration acceptance.
Evidence, baseline and exact owned-file delta live under
`target/speaker-workspace-20261025/backend-r1`.

## Frozen DTO contract v1 (2026-10-25)

This section is the authoritative exact response/argument shape. All fields below
are always present. `null` is explicit; fields are not omitted. JSON object member
order is irrelevant. Numeric values are JSON numbers. Revisions/counts and millisecond
bounds are nonnegative integers; selected revision must equal the current assignment
revision. Arrays may be empty unless noted. No DTO contains vectors or private text.

```typescript
type EmbeddingSpace = {
  model: string;
  revision: string;
  model_hash: string;
  preprocessing: string;
  dimension: number;
};
type EnrollmentCandidatesArgs = { job: string; track: string; speaker: string };
type EnrollmentCandidates = {
  job: string;
  meetingId: string;
  track: string;
  speaker: string;
  profileGeneration: number;
  assignmentId: string | null;
  personId: string | null;
  assignmentRevision: number | null;
  turns: Array<{
    turnId: string;
    startMs: number;
    endMs: number;
    eligible: boolean;
    reasons: Array<"unknown_speaker" | "missing_embedding" | "invalid_candidate" |
      "provenance_mismatch" | "same_track_overlap" | "already_enrolled">;
    activeSampleCount: number;
  }>;
  quality: { noise: "unmeasured"; echo: "unmeasured"; otherTrack: "unmeasured" };
};
type EnrollSelectedTurnsArgs = {
  job: string;
  track: string;
  speaker: string;
  assignmentId: string;
  personId: string;
  expectedAssignmentRevision: number;
  turnIds: string[]; // 1..128, unique, canonical IDs
  humanOrigin: string; // nonblank, <=1000 UTF-8 bytes, no control characters
};
type EnrollSelectedTurns = { sampleIds: string[]; profileGeneration: number };
type VoiceProfiles = {
  profileGeneration: number;
  profiles: Array<{
    personId: string;
    name: string;
    spaces: Array<{
      spaceId: string;
      space: EmbeddingSpace;
      activeCount: number;
      activeDurationMs: number;
    }>;
    revokedCount: number;
    invalidatedCount: number;
  }>;
};
type PersonSamplesArgs = { personId: string };
type PersonSamples = {
  profileGeneration: number;
  personId: string;
  samples: Array<{
    sampleId: string;
    assignmentId: string;
    assignmentRevision: number;
    currentAssignmentRevision: number;
    state: "active" | "revoked" | "invalidated";
    spaceId: string;
    space: EmbeddingSpace;
    meetingId: string;
    track: string;
    startMs: number;
    endMs: number;
    createdAt: string; // SQLite UTC: YYYY-MM-DD HH:MM:SS, enrollment creation
    revokedAt: string | null; // same format; null if legacy timestamp unknown
  }>;
};
type RevokeVoiceSampleArgs = {
  personId: string;
  sampleId: string;
  humanOrigin: string;
};
type RevokeVoiceSample = null;
type VoiceComparisonArgs = { job: string };
type VoiceComparison = {
  job: string;
  experimental: true;
  profileGeneration: number;
  speakers: Array<{
    track: string;
    speaker: string;
    queryStatus: "eligible" | "no_eligible_turns";
    spaces: Array<{
      space: EmbeddingSpace;
      status: "candidates" | "no_compatible_history" | "self_excluded" | "no_candidates";
      invalidHistorySamples: number;
      candidates: Array<{
        personId: string;
        name: string;
        meanCosine: number;
        maxCosine: number;
        supportTurns: number;
        supportDurationMs: number;
        activeSamples: number;
        turnDetailsTruncated: boolean;
        turns: Array<{
          turnId: string;
          startMs: number;
          endMs: number;
          cosine: number;
        }>;
      }>;
    }>;
  }>;
};
```

Field semantics and bounds:

| Field path | Exact meaning |
| --- | --- |
| `speakers[].queryStatus` | `eligible` when at least one valid structurally eligible turn with supported dimension exists; otherwise `no_eligible_turns` and `spaces: []`. Already-enrolled turns remain comparison queries. Unknown anonymous labels are omitted. |
| `speakers[].spaces[].status` | `candidates` when nonempty ranking; `no_compatible_history` when no active revision-matched sample exists in that exact space; `self_excluded` when all compatible history is excluded by meeting/hash; `no_candidates` when compatible history contains invalid samples and no usable nonself evidence. |
| `speakers[].spaces[].invalidHistorySamples` | Count of active, revision-matched rows in this exact space rejected for bad vector/provenance or unsupported dimension. Does not include revoked/invalidated rows. |
| `speakers[].spaces[].candidates` | Maximum three people, sorted by descending meanCosine then ascending person UUID for ties. Independent per anonymous label and embedding space. |
| `speakers[].spaces[].candidates[].meanCosine` | Plain arithmetic mean of the maximum compatible historical-sample cosine for that person on each evaluated query turn. No duration weighting and no probability/confidence interpretation; range [-1,1]. |
| `speakers[].spaces[].candidates[].maxCosine` | Maximum of those per-turn maxima, range [-1,1]. |
| `speakers[].spaces[].candidates[].supportTurns` | All evaluated turns for that label in this space, without acceptance threshold. |
| `speakers[].spaces[].candidates[].supportDurationMs` | Sum of all evaluated turn durations, including details omitted by the output cap. |
| `speakers[].spaces[].candidates[].activeSamples` | Number of valid compatible confirmed samples for that person after meeting/hash exclusion. |
| `speakers[].spaces[].candidates[].turnDetailsTruncated` | True exactly when supportTurns > 32. |
| `speakers[].spaces[].candidates[].turns` | First min(supportTurns,32) evaluated turns in canonical report order. No score is calculated from only the displayed subset. |
| `turns[].activeSampleCount` in enrollment list | Current active samples covering that exact source audio hash, track, interval and compatible space, across people. |

Complete comparison example (illustrative synthetic values, never calibration):

```json
{
  "job": "query-job-uuid",
  "experimental": true,
  "profileGeneration": 8,
  "speakers": [
    {
      "track": "mic",
      "speaker": "speaker-0",
      "queryStatus": "eligible",
      "spaces": [
        {
          "space": {
            "model": "synthetic",
            "revision": "1",
            "model_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "preprocessing": "synthetic-only",
            "dimension": 2
          },
          "status": "candidates",
          "invalidHistorySamples": 0,
          "candidates": [
            {
              "personId": "person-uuid",
              "name": "Example",
              "meanCosine": 0.6,
              "maxCosine": 0.6,
              "supportTurns": 1,
              "supportDurationMs": 200,
              "activeSamples": 1,
              "turnDetailsTruncated": false,
              "turns": [
                { "turnId": "a", "startMs": 0, "endMs": 200, "cosine": 0.6 }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

No-compatible-history and self-excluded spaces keep this same object shape,
with `candidates: []` and the corresponding status. A label with no usable query
has `{track,speaker,queryStatus:"no_eligible_turns",spaces:[]}`. Failed bounds,
missing jobs, malformed report/source bindings and stale selections reject IPC as
`Result::Err(String)`; there is no success DTO containing partial data.


## Additive R2 decision (frozen parent contract v2)

Authoritative parent contract SHA256: `cd5d968b871f440da8c8492248b7b558e37126a8f8a9e99752e14d9a599db9ee`.
The preceding v1 contract and frozen R1 artifacts remain evidence of R1; the following additive decision governs R2.

# Voice curation additive contract v2

Parent decision, 2026-10-25. This adds recoverable browsing and raises measured
comparison capacity; it does not change identity, consent, acoustic policy,
recognition, averaging, or sample retention. Frozen v1 evidence stays immutable.
Append this decision to spec 0078 before implementation. No schema migration.

## Narrower inventory design

Use stateless keyset pages instead of resumable aggregate scans or cached summary
jobs. The UI displays counts for loaded samples only, explicitly labelled as
partial until nextCursor is null. It does not claim global totals from one page.
Do not add a second counts cursor, background aggregate cache, or space-summary
endpoint in this increment. Existing v1 inventory commands remain available with
existing shapes/limitations for compatibility, but the product UI moves to the
new page commands. Other existing six commands keep their success shapes.

### Frozen new commands (camelCase IPC args)

```ts
type ProfilesPage = {
  profileGeneration: number;
  profiles: Array<{ personId: string; name: string }>;
  nextCursor: string | null;
  scannedRows: number;
};
// library_voice_profiles_page({ cursor?: string|null, limit?: number|null })
// Defaults: limit=25, allowed 1..50 integers.

type SamplesPage = {
  profileGeneration: number;
  personId: string;
  samples: PersonSamplesV1['samples'];
  nextCursor: string | null;
  scannedRows: number;
};
// library_person_samples_page({ personId: string,
//   cursor?: string|null, limit?: number|null })
// Defaults: limit=50, allowed 1..100 integers. No state filter in v2.
```

PersonSamplesV1 is exactly the frozen v1 PersonSamples type in contract-v1.md.
Sample fields, state precedence, space identity and audit dates do not change.
Profiles includes people with zero samples, as v1 did. Order is canonical ascending
SQLite rowid, not locale/name sorting. UI must not imply name/date order.

A first request captures profileGeneration and upper rowid of the relevant table.
An opaque cursor carries version, operation, person scope when applicable,
generation, upper rowid and last scanned rowid. It is <=2048 UTF-8 bytes, parsed
strictly and validated for types, ordering and scope. It is a pagination token,
not an authorization credential. No secrets, vectors, names, origin or consent
text in cursors. The backend never trusts it to remove bounds or cross scope.

Each request reads one snapshot. A generation mismatch returns the stable code
`voice_curation_refresh_required`, never silently mixes snapshots. Page refresh
starts again with cursor=null. At most 4096 physical rows are scanned per request,
with projection/serialization stopping at the requested item limit. Return a
cursor after the last scanned row, including on an empty progress page. Every
next cursor advances and remains <= captured upper rowid; completion is null.
No OFFSET and no per-person full-history deserialize. SQL should avoid loading
vectors or private human-origin/consent fields; if provenance JSON is needed to
extract public sample metadata, enforce a per-row byte check before reading it
and never serialize private fields. Reject an oversized/malformed target row
explicitly as `voice_curation_inventory_row_invalid`; do not fabricate or skip it.
Such corruption may block that person's page; it must not block profiles metadata
or target-scoped revocation. This bounded corruption limitation stays documented.

Profile names/metadata changes must invalidate a snapshot when relevant. Audit
that the existing generation covers every app mutation; if it does not, use a
separate safe cursor invalidation mechanism without changing legacy identity
semantics or adding writes to read-only calls. No live SQLite transaction is held
across UI requests. No server cursor registry or expiration service is required.

## Operation-specific admission

Remove shared all-retained-row/byte admission from candidate reads, selected
enrollment and comparison. Retained revoked/invalidated history never consumes
active-evidence capacity. Use the exact active join (non-revoked, confirmed,
matching assignment revision and person) for active quotas. Initial active
inventory admission remains 4096 rows and 32 MiB of active vector/provenance bytes;
selected enrollment checks the projected post-insert active size transactionally,
not just existing bytes. Oversized legacy active stores may refuse new enrollment
or computation, but v2 browsing and individual revocation remain available.
Retain all audit/history rows. Never prune or auto-revoke to meet a budget.

## Comparison success remains v1

- Evaluate every structurally eligible turn, at most 4096 canonical report turns.
- Selected enrollment still accepts only 1..128 explicitly selected unique IDs.
- Admit at most 1024 relevant active historical samples after compatible-space,
  same-meeting and identical-audio exclusions. No arbitrary sampling/first1024.
- Sum Q_space * H_space * dimension in checked arithmetic before scoring;
  reject the whole request above 1,100,000,000 scalar operations.
- Streaming sum/count/max/duration with canonical iteration/summation order;
  retain only first32 detail records, top3 per space. Exact v1 result equivalence
  required against the old algorithm on admitted synthetic inputs.
- Bound owned decoded input/workspace with explicit conservative allocation
  accounting (target128MiB) and measure RSS separately. Do not call that a bound
  on whole application RSS or a cross-hardware latency SLA.
- One owned background scorer at a time; no Store/DB connection moves to it.
  Library worker snapshots/prepares input, continues servicing status, revoke and
  save-related requests, then validates profile generation before publishing the
  completed result on the worker. Concurrent comparison rejects `voice_curation_busy`.
  Generation change rejects `voice_curation_refresh_required`, never a cached
  stale ranking. Check cancellation in bounded turn chunks; shutdown cancels and
  no late result publishes. Existing async comparison IPC still returns final v1
  Value, with no new polling/progress protocol.
- Typed first-line errors: `voice_curation_capacity_exceeded`,
  `voice_curation_refresh_required`, `voice_curation_busy`,
  `voice_curation_inventory_row_invalid`, `voice_curation_cursor_invalid`.
  Details must be safe categories/bounds, never vectors, origin or consent text.
  Existing errors outside these new conditions need not be rewritten.

## UI adaptation

Profile list has explicit Load more. Expanding a person fetches its first sample
page, with its own Load more; counts and space durations are calculated only from
loaded samples and labelled as such while partial. Do not auto-drain all pages.
Avoid duplicate append and stale responses; bind pages to person and generation.
On refresh-required, preserve the existing view as stale with explicit restart;
disable mutations against stale rows until refreshed. Individual revoke remains
possible in a fresh page even when comparison/enrollment are at capacity.
A successful mutation invalidates pages; do not append across generations.
Keep R4 same-person confirmation guard and playback unchanged.

## Required proof

1. >4096 retained rows, interleaved people, and >32MiB retained vector/audit data;
   zero/few active rows: all samples reachable exactly once, profiles accessible,
   selected enrollment and targeted revoke work; reads preserve DB/audit hashes.
2. Empty progress page, final completion, invalid/foreign/person-mismatched/large
   cursor, generation mutation between pages, repeated request, no duplicate item.
3. Byte/row admission includes pending inserts; failure rolls back all new samples,
   spaces and generation, preserves previous confirmation/history.
4. 720-turn and4096-turn comparison, all-turn support;1024 relevant history plus
   excluded/unrelated historical rows; above-cap refusal without partial ranking.
5. Background scoring: actual competing revoke/status requests complete before
   scorer release; stale result rejected; overlapping comparisons bounded;
   shutdown and cancellation cannot publish stale results. No sleep-only proof.
6. Release latency/memory measurements repeated in isolated fixtures; defaults and
   local-processing --lib/IPC plus strict Clippy, no app/operator data.
7. UI pagination/restart and stale-source tests, existing R4 behavior preserved.

F3 is already fixed in frontend R4 without changing legacy core confirmation.
F5: returned sampleIds are in canonical lexicographic turn-ID order, not request
order. F6: revokedAt is the latest explicit audited revocation event; null means
no recorded event, and does not assert the date of an earlier legacy revocation.


### R2 implementation notes

Pagination metadata fingerprint is scoped to the worker-lifetime InventoryPager epoch, same-connection total_changes, and SQLite data_version, read in one request snapshot with profileGeneration. Pure reads do not invalidate cursors. Unrelated private writes and rolled-back write attempts can conservatively require refresh; this benign tradeoff avoids changes to legacy identity semantics. No cursor registry or cross-request transaction exists.


### Parent clarification: target-scoped audit recovery

Explicit revocation covers malformed/oversized target provenance as well as normal rows. Ownership is always voice_sample.person_id. Valid JSON objects with missing/array curationRevocations preserve every original field and event; the former browse byte and 128-event caps do not gate target revocation. Invalid JSON, nonobjects, or a nonarray curationRevocations value are retained byte-for-byte as a private retainedInvalidProvenance string in a recovery object, with a new real UTC/human-origin audit event. This is explicit corrupt-audit recovery, not normalized or fabricated source provenance. Missing source metadata remains missing and strict inventory still rejects that row. Repeated revocation appends to the recovery object's valid audit array without nesting or duplicating the retained raw string. Flag, audit and generation change atomically. No vector is read/decoded, and no raw/origin is projected or logged. Frozen v1/v2 evidence is not rewritten.

### R3: independent review corrections R2-01 and R2-02

Scope: correct the decoded scorer workspace admission and frozen-v1 invalid-vector
classification. Existing algorithms, sum order, tie-break, every admitted query
turn, DTOs, identity/consent policy and frozen v1/v2 artifacts remain unchanged.

Workspace accounting includes each unique person's name and ID capacities for
both the accumulator identity set and the full pre-top3 ranking transition. The
final top3/output envelope also includes IDs, not just names. All new sums and
multiplications are checked. Long names accepted by existing person APIs do not
rely on a fixed per-person envelope to cover arbitrarily large copied strings.
Independent System-allocation probes run serially in a disposable copy and measure
live allocations, in addition to inspecting the conservative counter. Oversized
workspaces return the existing capacity error; ordinary/full-turn stress remains
admitted within the unchanged limits.

History vectors are decoded with dimension-bounded storage and validated before
same-meeting/identical-audio exclusion. Invalid data keeps frozen-v1 diagnostic
precedence (`invalidHistorySamples`, `no_candidates`). Valid source exclusions
remain exclusions; excluded rows do not consume the relevant-history quota. Vector
validation has its own checked temporary allocation envelope before loading JSON.
There is no new threshold, model-space mixing, sampling or partial ranking.

### Explicit writer boundary (parent decision R2-03)

Comparison publication assumes the existing single cooperative Store/library
writer. `library.lock` serializes Store owners and supported mutation APIs update
profile generation; the library worker checks that generation before publishing
an owned background result. Direct SQL from another connection that deliberately
bypasses both library.lock and generation is outside this guarantee and can leave
an in-flight comparison stale. R3 does not add protection against that writer.

The pager has a different boundary: its worker epoch, same-connection total_changes
and SQLite data_version fingerprint also detect external writes for cursor
invalidation. This extra pager check must not be described as protection of
comparison publication. No writer stamp, schema, legacy Store or DTO change is
introduced by this clarification.

### R4: fixed-width auxiliary history identity (R3-01)

Within the comparison preparation snapshot, use voice_sample.rowid as an i64
auxiliary lookup key for vector lengths, vector JSON and admitted person metadata.
Retain ORDER BY s.id, public UUID/text identity, full-turn iteration, frozen-v1
invalid-vector precedence, source exclusions, quotas and the exact scorer bytes.
A persisted oversized sample ID is not needed in Rust merely to classify/exclude
a row. No ID is truncated or rewritten and no malformed row is silently discarded.
The independent Astra 129 MiB sample-ID probe and System allocator must be byte
identical in red/green isolated runs. Audit adjacent pre-admission text projections
and record any additional measured budget exposure before extending this fix.
Cooperative-writer boundary R2-03 remains unchanged.

#### R4 measured pre-materialization admission audit

The adjacent audit reproduced oversized persisted embedding-space metadata in
both active-candidate counts and history matching. Preparation must numerically
admit the UTF-8 byte lengths and row counts of text it is about to materialize,
before requesting Rust Strings. The same admission covers candidate IDs/labels,
report/header text, assignment projections, and only the latest edits selected for
actual report segments. It never charges all retained edits or inactive voices.

Use checked conservative coexistence envelopes for decoded JSON/vector buffers,
serialized space-key expansion, identity copies and tree/row allocations, under
the existing 128 MiB preparation target. SQL aggregate overflow, invalid numeric
values, and NULL totals for nonempty projections fail with the existing capacity
code. Empty projections are zero only when row and valid-value counts are both
zero. No text is truncated, no reader validation is removed, and no stored field,
semantic policy, public DTO or legacy Store method is changed.

### R5: report collection capacity admission (R4-01)

Before materializing ProcessingResult, account for every deserialized collection:
segments (Vec<TranscriptSegment>), turns (Vec<SpeakerTurn>), warnings (Vec<String>),
and each optional turn embedding (Vec<f32>). JobInput contains four Strings and
has no ProcessingConfig/Value collection to charge. Keep the existing report byte
and row envelopes as well as all reader, Store, DTO and scorer behavior.

Use the pinned serde JSON sequence/push path and typed element sizes. For n > 0,
C(n) = checked_next_power_of_two(max(n, 4)) is the vector capacity upper bound for
these element types on the validated toolchain; C(0) = 0. Charge C(n) * size_of(T)
with checked arithmetic, twice for segments and warnings (a live/growing buffer
plus its previous allocation). For turns, separately charge twice the capacity
of Vec<SpeakerTurn> and twice Vec<Candidate>, using both actual element types,
so the report and its larger cloned candidate records can coexist with growth.
Charge nested embeddings three times (original, clone, growth/copy buffer).
Sum these bounds for
all collections, not just the largest one, alongside the already charged raw JSON,
string contents and row structures. Boundary tests must check actual capacities
and allocator peaks at 2^k minus one, equal, and plus one.

Read only numeric JSON array counts before admission. Required collections must
have non-NULL array counts; absent/null optional embeddings count zero, while an
invalid nonarray embedding cannot be accepted as zero. Stream embedding counts,
check the number of scanned turns, and fail count conversion, NULL, mismatch,
capacity rounding or multiplication/addition overflow with the existing Capacity
code. No report array or warning is truncated, sampled, silently dropped or changed.
The former 4,194,304-empty-warning control may conservatively refuse capacity,
as its typed capacity plus simultaneous buffers exceeds this bound. Preserve a
reasonable admitted control with full DTO equivalence and actual allocation proof.

The byte-identical independent R4 probe assumes admission and success; on the
malicious count, its R5 run must stop with Capacity at the initial preflight rather
than reach its success/memory assertion. Preserve that exact probe and original
red result. A separate bounded-rejection probe must measure the actual R5 error
path and assert Capacity, the 128 MiB peak limit and both database change counters.

### R6: reader-aligned object and positional report projections (R5-01)

Admission must cover both JSON representations accepted by the derived reader,
without normalizing, rewriting or rejecting valid positional records. Select paths
by json_type of each containing record: TranscriptSegment ID is $.id for an object
or $[0] for an array; SpeakerTurn embedding is $.embedding or $[5]. ProcessingResult
itself can be an object or the sequence [segments, turns, warnings], so its required
collection paths are $.segments/$.turns/$.warnings or $[0]/$[1]/$[2] respectively.
Mixed inner representations remain valid. Keep the reader responsible for its
existing field/sequence validation; required collection NULL/nonarray failures,
optional absent/null embeddings and checked cumulative counts retain R5 semantics.

Apply the same segment-path selection to the exact meeting/job/segment-target and
latest-edit-id projection. Charge only the latest edit for each actual selected
segment, with all accepted IDs and their escaped/Unicode/control/NUL contents.
Retained older edits and unmatched targets remain uncharged and preserved.
No Store, deserializer, DTO, scorer, policy, schema or stored content changes.

Audit every JSON projection in report admission against its typed consumer,
including the outer ProcessingResult. JobInput's object/sequence forms contain only
four Strings and have no field-selective projection in this path; its byte charge
already covers both. Other typed private payloads are charged as whole JSON, not
projected field subsets. Preserve the supplied positional probe/allocator exactly:
its original success assumption now ends with Capacity at preflight. Separately
measure bounded rejection and valid object/positional/mixed v1 equivalence, latest
escaped/cumulative edits and one/two/three large positional embeddings. No array or
warning may be truncated or ignored to obtain a passing result.
