# Captured pre-session v3 library

Disposable synthetic fixture, generated before session code was introduced by
executing the captured old core with `generate.rs`. This is not current-schema
DDL relabeled as v3. `provenance.json` pins old module files, HEAD, baseline manifest
and each captured database/raw/generator file. `captured-source/` retains the actual
v3 migration implementation and schemas. The full baseline is under the evidence
path in spec 0070, not a Git commit (core was untracked at that HEAD).

The standalone generator manifest shown here was executed from
`target/session-foundation-20261024/v3-generator`, using the sibling baseline source
snapshot as its library path. Run its recorded command from repository root with
an isolated Cargo target and a **new disposable destination**. Generation uses
random UUIDs/timestamps, so a regeneration has different bytes and must be pinned
again; tests consume this fixed captured fixture, never regenerate from new DDL.

Contents: two meetings (one finished synthetic two-track capture, one without
audio), successful job, immutable artifact, human correction, person, assignment
and confirmed assignment history. There are no real names, credentials or calendar
records. Runtime `library.lock` is excluded; SQLite database contents are unedited.

The fixture includes no personal Markdown creation. Note/board preservation tests
supply their own byte sentinels beside the disposable library.
