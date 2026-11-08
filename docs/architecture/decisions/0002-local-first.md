# ADR-0002: Local-first in F1, sync in F2

> Emenda 2026-10-17: ADR-0018 e spec 0058 prevalecem no domínio de reuniões.
> Linux+Windows, biblioteca independente de notas, trilhas originais separadas,
> core sem Tauri, bancos canônicos separados e identidade apenas confirmada.
> Regras anteriores conflitantes permanecem abaixo como histórico, sem vigência.


- **Date:** 2026-04-18
- **Status:** Accepted

## Context
The MVP must work without a backend or internet connection. Granola
and Fathom have validated that a local-first notetaker is viable.

## Decision
F1 is fully local, filesystem-canonical. F2 adds an optional Rust
sync server (Axum + Postgres). Architecture stays ready for it.

## Consequences
- **+** Zero initial setup, works offline
- **+** Data always belongs to the user
- **−** Multi-PC has to wait for Phase 2
- **−** Bitrot risk if the user loses their PC
  (mitigable by pointing Syncthing at `~/coxinha/`)
