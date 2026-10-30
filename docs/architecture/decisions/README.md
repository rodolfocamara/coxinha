# Architecture Decision Records

ADRs record important architectural decisions. One decision per
file. Lean format (look at any existing ADR as a template).

## Conventions

- Files numbered with 4 digits: `0001-*.md`
- Filename in kebab-case, short
- Never renumber or reuse an ADR number. If a decision is reversed,
  create a new ADR that marks the old one as `Superseded by ADR-NNNN`
- Possible statuses: `Proposed`, `Accepted`, `Deprecated`,
  `Superseded by ADR-NNNN`

## Index

| #    | Title                                                     | Status   |
|------|-----------------------------------------------------------|----------|
| 0001 | [Tauri over Electron or plain web](./0001-tauri.md)       | Accepted |
| 0002 | [Local-first in F1, sync in F2](./0002-local-first.md)    | Accepted |
| 0003 | [BlockNote as the editor](./0003-blocknote.md)            | Accepted |
| 0004 | [Pure Rust, no Python sidecar](./0004-pure-rust.md)       | Accepted |
| 0005 | [`genai` crate for LLM](./0005-genai-llm.md)              | Accepted |
| 0006 | [Cargo workspace for the monorepo](./0006-cargo-workspace.md) | Accepted |
| 0007 | [Tray-resident pattern](./0007-tray-resident.md)          | Accepted |
| 0008 | [STT as a pluggable trait](./0008-stt-trait.md)           | Accepted |
| 0009 | [Diarization as a pluggable trait](./0009-diarization-trait.md) | Accepted |
| 0010 | [ONNX Runtime as the ML runtime](./0010-onnx-runtime.md)  | Accepted |
| 0011 | [Mermaid and Excalidraw deferred to F1.5](./0011-diagram-blocks-f15.md) | Accepted |
| 0012 | [i18n with react-i18next + rust-i18n](./0012-i18n.md)     | Accepted |
| 0013 | [Accessibility baseline (WCAG 2.1 AA)](./0013-a11y-baseline.md) | Accepted |
| 0014 | [Audio toolkit ported from Handy](./0014-audio-toolkit-from-handy.md) | Accepted |
| 0015 | [Layered architecture — Knowledge vs Memory](./0015-layered-knowledge-memory.md) | Accepted |

| 0018 | [Biblioteca local e identidade confirmada](./0018-meeting-library-and-identity.md) | Accepted |

| 0021 | [Separate durable capture from local incremental inference](./0021-local-incremental-asr.md) | Accepted |

## Template

```md
# ADR-NNNN: Short, imperative title

- **Date:** YYYY-MM-DD
- **Status:** Proposed | Accepted | Deprecated | Superseded by ADR-XXXX

## Context
What problem / pressure / trade-off motivated the decision.

## Decision
What was decided. One crisp sentence, then details if needed.

## Consequences
- **+** upsides
- **−** costs / risks / what becomes harder
```
