# Conventions

Code conventions for Coxinha. These are defaults — exceptions must
be justified in the PR, and if one becomes a recurring pattern it
graduates into an ADR.

## Language in code: English only

Every `.rs`, `.ts`, `.tsx`, `.json` (schema), `.yml` (schema),
`.css`, commit message, test name, and variable/function identifier
lives in English. Period.

The only place Portuguese (or any other natural language) shows up
is:
- User-facing strings routed through `t('key')` or `t!("key")`
- `.md` files in `docs/` written for human readers
- Git commit messages when the diff is purely user-facing Portuguese
  (rare; default to English)

Quick grep check before committing:

```bash
git diff --staged -- . ':!src/locales' ':!src-tauri/locales' ':!docs' \
  | grep -P '[\p{Latin}&&[^\x00-\x7F]]'
```

(Unix/Git Bash. `-P` turns on Perl regex so the Unicode Latin class
covers every accented character, uppercase included. The pathspec
excludes locale catalogs and docs — both legitimately hold
non-ASCII.) If that prints any `+` line, fix it.

## Comments: WHY, not WHAT

Only comment when the WHY is non-obvious:
- Hidden constraint (OS quirk, Tauri plugin oddity, BlockNote API)
- Subtle invariant
- Workaround tied to a specific bug or upstream issue
- Behavior that would surprise a careful reader

**Do not** comment to:
- Restate what the identifier already says
  (`// fetches notes` above `async fn fetch_notes(...)`)
- Narrate the current diff or reference the task
- Describe parameter types or return values (types already do)
- Document what a 3-line block does when it's obvious

If removing the comment wouldn't confuse a future reader, don't
write it.

## Rust

- Tauri commands return `Result<T, String>`; map `anyhow::Error` with
  `.map_err(|e| e.to_string())`
- Internally: `anyhow::Result` for generic flow, `thiserror` for
  custom error types when it pays off
- Logging: `tracing` + `tracing-subscriber`; never `println!` in
  production paths
- Async: `tokio` (ships with Tauri); never `block_on` inside the
  Tauri `setup` closure (it panics — see lessons)
- Tests: `#[cfg(test)]` inline with the module under test
- No new macros — reach for existing ones

## Frontend

- Function components, strict TypeScript
- Zustand for global state (keeps Redux/Context boilerplate out)
- shadcn components copy-pasted into the tree, not installed as a
  dependency
- Tailwind; no CSS modules

## i18n

- **Zero hardcoded UI strings.** Every visible text resolves through
  `t('key')` (frontend: `useTranslation()`; Rust: `t!("key")` macro)
- Locale files:
  - Frontend: `src/locales/<lang>.json`
  - Rust: `src-tauri/locales/<lang>.yml`
- Keys grouped semantically (`nav.*`, `sidebar.*`, `tray.*`, ...)
- Brand string `"Coxinha"` is the only allowed literal
- Error/log messages (developer-facing) stay in English prose; they
  are not i18n-tracked

## Accessibility

- **Semantic HTML first.** `<button>`, `<nav>`, `<main>`, `<aside>`,
  `<header>`, `<footer>` — not `<div onClick>`
- **Every icon-only control has an `aria-label`** (or visible text)
- Keyboard reachability: every interactive element works with
  Tab + Enter/Space; no mouse-only paths
- Focus ring visible; never removed without a replacement
- Respect `prefers-reduced-motion`
- Color contrast: text ≥ 4.5:1, UI components ≥ 3:1
- Dialogs trap focus while open and return focus on close

## Anti-patterns in this project

- Treating the notes index as canonical, or deleting canonical meeting/profile DBs as cache (ADR-0018)
- Making external calls without explicit user configuration
- Enabling auto-update or analytics by default
- Duplicating `shared::*` types on the frontend instead of using
  the generated bindings
- Hardcoded UI strings in JSX or Rust — always i18n
- `<div onClick>` when a `<button>` would do
- Icon-only buttons without an `aria-label`
