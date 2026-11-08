# Spec 0004: Database migrations

> Emenda 2026-10-17: o domínio novo de reuniões/perfis usa runner transacional
> `user_version` em coxinha-core (ADR-0018/spec0058). O índice de notas legado
> permanece separado; esta fatia não o converte nem declara esta spec concluída.


- **Status:** draft
- **Phase:** F1
- **Owner:** Rodolfo
- **Depends on:** spec 0005 (notes)
- **Relevant ADRs:** —

## Why
`Db::migrate` is inline SQL executed via `execute_batch`. This
works once, but the moment we add a second schema change the
upgrade path becomes silent breakage on existing vaults. Yes,
the DB is rebuildable from the vault — but that's the fallback,
not a strategy.

## Scope

### In
- Adopt `refinery` (pure Rust, embeds SQL files at compile time)
  or `rusqlite_migration` — whichever produces a smaller binary
- Existing schema becomes `migrations/V1__initial_schema.sql`
- Migrations are forward-only; a migration failure rolls back
  the transaction and aborts app startup with a clear error
- Version tracked in `__refinery_schema_history` (or the
  equivalent table for the chosen crate)
- On version mismatch:
  - App newer than DB → run pending migrations
  - App older than DB → refuse to start with a message telling
    the user to update (or restore from backup, spec 0016)

### Out
- Down-migrations (we don't support downgrades; rebuild from
  vault is the escape hatch)
- Data-level migration helpers — the vault is canonical; index
  can always be regenerated

## Behavior (acceptance)
- Fresh install creates the V1 schema and records V1 as applied
- Adding V2 and shipping → app runs V2 once on existing users'
  DBs, idempotent on subsequent launches
- Rolling the app back to an older version after V2 ran → app
  refuses to start with a specific error code
- A failing migration (syntax error, constraint violation) aborts
  startup and surfaces the SQL + the error to the log

## Design notes
- Migration files under `src-tauri/migrations/`
- `embed_migrations!()` at crate root (compile-time inclusion)
- `Db::open` runs the migration runner before returning
- CI: add a "migrations apply" check that boots the binary once
  against a disposable vault

## Open questions
- `refinery` vs `rusqlite_migration`? Both are ~7KB. refinery
  has better docs; pick refinery.
- Where does migration logging go? The main `tracing` output is
  fine.
