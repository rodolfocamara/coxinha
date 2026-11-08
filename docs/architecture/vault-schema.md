# Vault file schemas

> Emenda 2026-10-17: ADR-0018 e spec 0058 prevalecem no domínio de reuniões.
> Linux+Windows, biblioteca independente de notas, trilhas originais separadas,
> core sem Tauri, bancos canônicos separados e identidade apenas confirmada.
> Regras anteriores conflitantes permanecem abaixo como histórico, sem vigência.


Every file Coxinha writes into `~/coxinha/` follows a declared
schema with an explicit version. The filesystem is canonical
(ADR-0002), so these files must be self-describing — any tool
reading the vault without Coxinha still has to understand what is
there.

Changes to any schema on this page are architectural: they ship
with a version bump and an ADR explaining why.

## Versioning rules

Every structured file (`*.json`, `*.toml`) carries a `version`
integer starting at `1` at the top level.

- **Additive change** (new optional field): bump `version`, read
  older files with `#[serde(default)]`
- **Breaking change** (rename, type change, required field): bump
  `version`, ship a migration per spec 0004 (DB) or spec 0015
  (filesystem re-scan)
- **Unknown future version** seen at read time: refuse to load
  that file and surface "please update Coxinha" — same policy as
  the DB migrator

Markdown files (`*.md`) don't carry a version number in the
filename; their contract is the presence/absence of YAML
frontmatter fields listed below.

## `notes/*.md`

Plain Markdown. Obsidian, VS Code, and Notepad open it unchanged.

Optional YAML frontmatter (same format Obsidian uses):

```yaml
---
id: 018f3b5a-0000-7000-8000-000000000000
tags: [idea, coxinha]
meeting: 018f3b5a-1111-7000-8000-000000000000
---

# Title comes from the first heading
Body in regular markdown.
```

- `id` — UUID v7 when possible (v4 is acceptable). Created on
  first write; persisted so renames don't break links.
- `tags` — merged with inline `#tag` occurrences in the body.
- `meeting` — optional cross-link to a meeting UUID (see the
  meeting-note link rule below).

When Coxinha ingests a hand-written `.md` without `id`, it
generates one and writes it back on the next save.

## Note ↔ meeting link — canonical rule

**The UUID in the frontmatter is the only canonical link.** One
rule, everywhere:

- A note references its meeting via `meeting: <uuid>` in
  frontmatter.
- A meeting does not list its notes — the reverse index is
  rebuilt from `notes_meeting_idx` in the DB by scanning
  frontmatter during `upsert_note` / `rebuild_from_vault`.
- Wiki-links (`[[...]]`) are note-to-note only (spec 0013). They
  do **not** link to meetings in F1; meetings have their own UI
  surface (spec 0009).

Why UUID over slug: the human-readable slug can change (rename a
meeting) without breaking links. Slugs are for the user; UUIDs
are for the machine.

## `meetings/<uuid>/metadata.json`

Per-meeting JSON, written by `recorder.rs` on start and updated
on every state transition.

```json
{
  "version": 1,
  "id": "018f3b5a-1111-7000-8000-000000000000",
  "title": "Product sync",
  "slug": "2026-04-18-product-sync",
  "started_at": "2026-04-18T13:00:00Z",
  "ended_at": "2026-04-18T13:47:22Z",
  "duration_seconds": 2842,
  "participants": ["Alice", "Bob"],
  "source_app": "Microsoft Teams",
  "status": "ready",
  "error": null,
  "artifacts": {
    "recording": "recording.wav",
    "transcript": "transcript.json",
    "summary": "summary.md"
  }
}
```

Field notes:

- `slug` is derived from `started_at` + `title`. Human-readable
  only; never used as the canonical key.
- `status` is the meeting-pipeline state (see
  `meeting-pipeline.md`). Valid values: `recording`, `recorded`,
  `transcribing`, `transcribed`, `diarizing`, `diarized`,
  `summarizing`, `ready`, `failed`, `partial`.
- `error` carries a human-readable string when `status` is
  `failed`; `null` otherwise.
- `artifacts` lists relative filenames inside the meeting folder,
  so the consumer doesn't have to guess.

## `meetings/<uuid>/recording.wav`

16kHz mono, 16-bit PCM WAV. Header is written incrementally so a
crash during recording leaves a playable file up to the kill
point.

## `meetings/<uuid>/transcript.json`

Produced by the `transcribe_meeting` orchestration.

```json
{
  "version": 1,
  "meeting_id": "018f3b5a-1111-7000-8000-000000000000",
  "language": "pt",
  "transcriber": {
    "engine": "whisper",
    "model": "ggml-base.bin",
    "accelerator": "cpu"
  },
  "diarizer": {
    "engine": "pyannote",
    "models": ["segmentation-3.0.onnx", "wespeaker_en_voxceleb_CAM++.onnx"]
  },
  "segments": [
    {
      "start": 0.0,
      "end": 3.4,
      "text": "Hello everyone",
      "speaker": "Speaker 1",
      "confidence": null
    }
  ]
}
```

Segments are ordered by `start`. `speaker` is `null` when the
diarizer is `None` or failed. `confidence` is optional and
engine-dependent.

## `meetings/<uuid>/summary.md`

Plain Markdown with YAML frontmatter so the user can open it in
Obsidian:

```md
---
meeting: 018f3b5a-1111-7000-8000-000000000000
llm:
  provider: claude
  model: claude-sonnet-4-5
generated_at: 2026-04-18T13:50:00Z
---

## Executive summary
...
```

Body follows the layout `summarizer.rs::DEFAULT_PROMPT` asks for:
Executive summary, Topics discussed, Decisions, Actions, Open
items. Sections that the LLM omits are omitted from the file
(not empty-printed).

## `attachments/*`

Opaque binary (WebP from image paste, future `.excalidraw.json`).
No version header — the referencing markdown owns the contract.

## `daily/YYYY-MM-DD.md`

Same rules as `notes/*.md`. The filename encodes the day; no
frontmatter date field is required.

## `.coxinha/config.toml`

TOML deserialized into `shared::AppConfig`. New fields are added
with `#[serde(default)]` so older configs still load. Breaking
changes bump the embedded `version` integer and require an ADR.

## `.coxinha/index.db`

SQLite + FTS5. **Not canonical** — rebuildable from everything
above via `rebuild_from_vault`. Schema version tracked by the
migration runner (spec 0004).

## `.coxinha/models/*`

Third-party model files (GGUF, ONNX). Schema is whatever the
model upstream defines. Coxinha only records the path in
`config.toml`.
