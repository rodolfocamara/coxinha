# ADR-0015: Layered architecture — Knowledge vs Memory

> Emenda 2026-10-17: ADR-0018 e spec 0058 prevalecem no domínio de reuniões.
> Linux+Windows, biblioteca independente de notas, trilhas originais separadas,
> core sem Tauri, bancos canônicos separados e identidade apenas confirmada.
> Regras anteriores conflitantes permanecem abaixo como histórico, sem vigência.


- **Date:** 2026-04-19
- **Status:** Accepted

## Context
Coxinha ships F1 as a notetaker + bot-less meeting recorder, but
the long-range product is a local-first second brain: search →
related-content → suggestions → eventually an agent layer over the
user's own corpus. Without naming the seams up front, F1 code tends
to bake "what the app does today" into structures that a future
reasoning or memory layer has to tear out.

Two classes of failure we want to prevent:

1. **AI-derived data drifting into ground truth.** If an LLM-
   extracted fact about the user accidentally ends up in the same
   table the user writes to, a bad inference pollutes the corpus
   forever. Obsidian / Logseq keep this invariant because they
   have no AI; systems that bolted AI on (Mem, various "smart"
   notebooks) frequently lose it.

2. **Indices quietly becoming authoritative.** When the SQLite
   index carries data that the files don't (tags, relations,
   metadata only the DB knows), "delete the DB and rebuild"
   silently loses state, and any future sync layer has to treat
   the DB as canonical — exactly what CLAUDE.md says we won't do.

## Decision

Name six layers explicitly and enforce two invariants across them.

```
Inputs → Raw → Processing → Knowledge (truth) → Graph → Reasoning
                                   │
                                   ↓
                          Memory (AI-derived, suggestion)
                                   │
                                   ↓
                    Outputs: search · related · insights · actions
                                   │
                                   ↓
                            Agents (MCP / API / CLI)
```

| Layer | What goes here | Today (F1) | Future |
|---|---|---|---|
| **Inputs** | Every way a fact arrives | Markdown, WASAPI audio, Obsidian vault adoption | Excalidraw canvas, OCR on pasted images, external integrations (MS Graph, Google) |
| **Raw Data** | Bytes on disk + append-only events | `~/coxinha/` tree + SQLite index (`index.db`) | Event log for the reasoning engine to replay |
| **Processing** | Parse/extract/transform; always re-runnable | Markdown parse, title/tag extraction, image compression | OCR pipeline, transcription, summarization, embedding |
| **Knowledge (truth)** | Documents, entities, relations, links — user-authored or unambiguous derivations | `notes`, `meetings`, `links` (spec 0013), `attachments` | `entities`, `relations`, canvas elements, OCR text bound to its image |
| **Graph (view)** | A projection of Knowledge | Implicit via `links` + FTS queries | Explicit graph UI (spec 0012 Excalidraw, later spec for force-graph view) |
| **Memory (suggestion)** | AI-derived, user-rejectable, always linked back to a source | — (F4) | Facts, preferences, decisions, embeddings (spec 0030 + 0034) |
| **Reasoning Engine** | Rules + orchestration over Knowledge + Memory | Implicit: meeting pipeline (spec 0008) | Cross-doc synthesis, pre-meeting briefing (spec 0035), auto-tagging (spec 0036) |
| **Outputs** | What the user sees: search, related, insights, actions | FTS5 search, backlinks | RAG chat (spec 0032), timeline (spec 0029) |
| **Agents** | External consumers of the same surfaces | — | MCP server (spec 0033), CLI, desktop app in the role of "another agent" |

### Invariant 1 — Knowledge is the source of truth

Plain files under `~/coxinha/` are authoritative. The SQLite index
must be reproducible from the files via `rebuild_from_vault` (spec
0004 / 0005); any feature tempted to store state the files don't
carry must either (a) also write that state into frontmatter /
sidecar files, or (b) be marked as part of the Memory layer.

This is what makes "filesystem is canonical" from CLAUDE.md
operational: if the user opens `~/coxinha/notes/*.md` in Obsidian,
they still have every fact the app thinks it knows.

### Invariant 2 — Memory is derived, never authoritative

Facts, preferences, embeddings, decision traces — anything an LLM
or rule extracted — live in Memory, **labelled as suggestion**.
Every memory record references the source document(s) it was
derived from, carries a confidence score, and can be dismissed by
the user. A note the user actually wrote cannot be dismissed; a
memory can.

The Memory layer physically lands under `.coxinha/memory/`
(rebuildable like the index) and references knowledge by stable
document id. It never mutates a markdown file behind the user's
back — it may *suggest* mutations the user can apply.

This maps onto projects in the Hindsight / memory-palace tradition:
pull structured knowledge out of unstructured corpus, surface it
only where relevant, and let the user decide whether a fact
graduates back into Knowledge.

## Consequences

- **+** Every F1 spec has an unambiguous home: notes (0005) and
  meetings (0007/0008) feed Knowledge; Settings (0010) doesn't
  touch either layer; audio capture (0007) lives in Processing.
- **+** Future AI work (F4 specs 0030–0036) slots into Memory
  without redesigning the notes schema.
- **+** Forces every new feature to answer *"knowledge or
  memory?"* at spec time — rejecting answers like "both" surfaces
  bad designs early (e.g., *auto-tag a note* is ambiguous: the
  applied tag is Memory-inferred, but the rendered tag in the
  markdown is Knowledge — only the first is dismissible).
- **−** Adds vocabulary the codebase doesn't need today. The
  payoff is deferred to F4; for now the diagram sits in the README
  and this ADR. Re-evaluate if F4 slips past 12 months from this
  date.
- **−** The Memory ↔ Knowledge boundary is subtle. We'll need a
  running list of canonical examples in `docs/lessons.md` to stop
  the boundary eroding under implementation pressure.

## Follow-up

- Spec 0005 / 0013 / future specs add a "Layer" line to the
  header (Knowledge / Processing / Output / etc.) so that
  placement is explicit, not implied.
- `CLAUDE.md` gains a one-line pointer to this ADR under
  Invariants — rewrite of the invariant itself stays there.
