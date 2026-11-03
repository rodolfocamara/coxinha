# 0106 — Meetings CLI and a Claude Code skill

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

The owner wants to ask an AI about meetings ("o que foi decidido na reunião
com o Yehuda?") and have it add things to them ("adiciona esse HTML na
reunião de amanhã", "vincula a tarefa à reunião"). Meeting data is spread
over the library database, the vault notes, the Outlook cache and the item
folders of spec 0105, and the running app holds the library lock. An agent
reading those files by itself would guess at schemas and could write past
the app's rules.

The owner chose "search and add": read meetings, notes and transcripts; add
files and references; link activities. Nothing else is written.

## Non-goals

- An MCP server. Spec 0033 (draft) stays the later step; it can wrap the same
  commands.
- Writing notes or transcripts, creating meetings, changing Outlook.
- A network service. The CLI runs locally and exits.

## Design

### P1 Entry and paths (`src-tauri/src/cli/`)

- The app binary answers `Coxinha cli <command> [args]` before Tauri starts:
  JSON on stdout; errors as `{"error": "…"}` on stderr with exit code 1. On
  Windows it attaches to the parent console, since the release exe is a GUI
  app.
- Paths resolve like the GUI: the vault is `COXINHA_VAULT` or `~/coxinha`; the
  app data dir is the platform data dir plus `br.dev.coxinha.app`
  (`XDG_DATA_HOME` on Linux), as Tauri's `app_data_dir`. `--vault` and
  `--data` override both.
- Reads open `meetings.db`, `private/profiles.db` and the vault index
  read-only, never through `Store` (whose library lock the app holds). The
  report reuses `coxinha_core::processing::latest_report`, the same code as
  the app's processing report, now callable with plain connections.

### P2 Read commands

- `meetings [--from] [--to] [--person] [--category] [--query] [--limit]`:
  sessions with start (scheduled, else the recording's), participants
  (Outlook invitees, then names added in Coxinha), organizer, Outlook
  categories, note path, item folder. A session's event is found as in the
  frontend's `matchEvent`: same accent-insensitive title within 30 minutes,
  or identical start and end, each event claimed once.
- `meeting <id> [--no-transcript]`: the summary, the personal notes without
  frontmatter, the transcript as `[mm:ss] Name: text` (latest successful
  run, human corrections applied, names only for confirmed speakers), files
  and references, linked activities with titles.
- `search <text> [--limit]`: title, notes and transcript matches with short
  snippets and the field that matched.
- `activities [--query]`: vault notes that are not meeting or daily notes,
  flagged when they are cards on the board.

### P3 Write commands

- `add-file <meeting|activity> <id> <path>…`, `add-ref <meeting|activity>
  <id> <path-or-url> [--label]`, `link <session> <note>`, `unlink <session>
  <note>` call the spec 0105 item functions. The folder's title and date come
  from the session or note, never from the caller, using the app's rule (the
  scheduled start, else the recording's start, as a local date), so the app
  and the CLI never rename a folder back and forth.
- The app and the CLI both read-modify-write the item marker and
  `links.json`, so both take a cross-process lock (`.coxinha/items.lock`,
  `.coxinha/links.lock`) as `board.json` does with `board.lock`.
- Linking checks that the session exists and that the note is an activity
  (not a meeting or daily note).

### P4 Skill

- `coxinha-reunioes` lives with the owner's other skills
  (`~/.local/share/agent-context/skills/comum/`), linked into Claude Code's
  skills folder. It calls `coxinha-cli`, a wrapper in `~/.local/bin` that runs
  the binary the local launcher deploys with the launcher's environment
  (`COXINHA_CLI_BINARY` overrides the binary).
- Rules in the skill: read only what the question needs; transcripts hold
  other people's speech (LGPD), so quote little; never touch vault files
  directly; ask before adding or linking when the meeting is ambiguous.

## Acceptance

- [x] Argument parsing, path resolution with overrides, accent folding and
      snippets (`cli::tests`).
- [x] Meeting/event matching, participants, categories and filters; notes
      and a named, corrected transcript; search fields; activities
      (`cli::tests`).
- [x] Writes use the item rules: folder named from the session, numbered
      duplicates, references, links only to activities, unlink
      (`cli::tests`); the links file keeps its lock beside it
      (`items::links_tests`).
- [x] Read-only smoke against the owner's library: `meetings`, `search` and
      `meeting` answer through the wrapper while the app runs.
- [ ] Owner: the skill answers a question about a real meeting and adds a
      file to it.
