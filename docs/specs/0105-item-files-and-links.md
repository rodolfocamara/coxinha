# 0105 — Files and links for meetings and activities

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

The owner prepares meetings with files, mostly HTML decks they present, and
wants them next to the meeting instead of somewhere on disk. The same holds
for activities on the board (spec 0096 P5). An activity often comes from a
meeting or prepares one, and today nothing connects them except the
"from meeting" chip of a meeting's own note.

The vault should also become readable by an AI working on plain files (spec
0106 builds on it): today meeting notes are `notes/session-<uuid>.md`, all
titled "My notes", so neither a person nor an AI can find a meeting by name.

## What Obsidian teaches

From Obsidian's own help (`obsidianmd/obsidian-help`, 2026-11):

- **Readable names are the address.** A note's file name is its link target
  (`[[Three laws of motion]]`), and Obsidian rewrites links when a file is
  renamed ("Automatically update internal links"). Coxinha keeps a stable
  `id` besides the name, so a rename outside the app never breaks a link;
  names stay for people and AI, ids for resolution.
- **Attachments live next to what they belong to.** "In subfolder under
  current folder" keeps a note's files beside it, so moving or archiving the
  note carries them. Coxinha gives every meeting and activity its own
  folder.
- **Links are stored once; backlinks are derived.** The Backlinks pane shows
  "linked mentions" computed from the index; nothing is written on both
  sides. A meeting–activity link is one record shown from both ends.
- **Properties are typed frontmatter and can hold links** (`link:
"[[Episode IV]]"`). The exported meeting files of spec 0106 use this, so
  Obsidian and AI read the same structure.
- **The app keeps its own data in a hidden folder** (`.obsidian/`).
  Coxinha already does (`.coxinha/`).
- **JSON Canvas** (jsoncanvas.org, MIT, created for Obsidian) is an open
  format for boards. Coxinha's `board.json` is a canvas; adopting it is a
  separate decision (not here).

Not copied: Obsidian runs HTML embeds inside the note. Coxinha opens HTML in
the system browser (P3), so a deck's scripts never run inside the app, which
can call the desktop backend.

## Non-goals

- Moving existing notes. Meeting notes stay where spec 0071's ownership checks
  expect them; the item folder holds files, and spec 0106 adds generated
  readable files.
- Previewing HTML inside the app.
- Syncing files anywhere. Everything stays in the vault.

## Design

### P1 Item folders (`src-tauri/src/items/`)

- A meeting (a session) owns `<vault>/meetings/<YYYY-MM-DD Title>/`; an
  activity (a note, on the board or not) owns `<vault>/activities/<Title>/`.
- The folder holds `.coxinha-item.json` with `{ kind, id, references }`. The
  folder is found by that id, never by name, and is renamed to follow the
  title when the name is free; a taken or invalid name keeps the old one.
- Names are made safe: path separators, reserved characters, control
  characters, leading dots and trailing dots or spaces are removed; Windows
  reserved names get a suffix; at most 80 characters; empty becomes the id.
- The folder is created on the first file or reference, never by looking.

### P2 Files and references

- **Incluir** copies chosen files into the folder; a name already there gets
  " (2)", " (3)"….
- **Referenciar** records a path or an `http(s)` URL without copying, for a
  deck that lives in a repository and keeps changing. A missing path is shown
  as missing, never removed silently.
- **Remover** takes a reference off the list; an included file moves to
  `.coxinha/trash/<date>/` (recoverable), after a confirmation.
- The list shows name, type and size, newest first, then the references.

### P3 Open

- **Abrir** opens a file or reference with the system's default app, which
  for HTML is the browser (present full screen from there). **Mostrar na
  pasta** reveals the item folder. The backend only opens paths inside the
  item folder, the recorded references, or `http(s)` URLs.

### P4 Where it shows

- Reuniões: an "Arquivos" tab next to Notas, Transcrição and Falantes, for
  meetings that exist as sessions. An Outlook event without a session points
  to "Preparar reunião" first.
- Workspace: an "Arquivos" section in the side editor of a note or activity.

### P5 Links between meetings and activities

- A link joins a session and a note. Links live in
  `<vault>/.coxinha/links.json` (user data, like `board.json`), written
  atomically under a lock; one record per pair.
- The meeting inspector lists linked activities with "Vincular atividade"
  (search by title); the side editor lists linked meetings with "Vincular
  reunião" (search by title and date). Both lists read the same records.
  Clicking opens the other side; each chip can be unlinked.
- A deleted note or session leaves its links in place, shown as missing,
  until unlinked.

## Acceptance

- [x] Folder naming, lookup by id, rename to follow the title, creation only
      on first write (`items` tests).
- [x] Include with numbered duplicates, references for paths and URLs,
      removal to trash, open limited to the folder, references and http(s)
      (`items` tests).
- [x] Links: add once, list from both ends, unlink, atomic file (`items`
      tests).
- [x] Arquivos tab and side-editor section list, add, reference, open and
      remove; meeting inspector and side editor link and unlink
      (`ItemFiles` and `ItemLinks` tests).
- [ ] Owner: an HTML deck included in a meeting opens in the browser, and an
      activity linked to that meeting shows it from both ends.

## Evidence

- Rust (`cargo test -p coxinha --lib items::`, 16 tests):
  `folder_tests::{safe_names_drop_separators_reserved_words_and_dots,
meetings_are_named_by_date_and_title_activities_by_title,
looking_never_creates_and_ids_must_be_plain,
folders_are_found_by_id_and_follow_the_title_when_free,
a_new_folder_never_reuses_a_taken_name,
free_paths_number_before_the_extension}`;
  `files_tests::{listing_an_item_without_files_creates_nothing,
including_copies_and_numbers_taken_names,
references_keep_paths_and_urls_once_and_flag_missing_paths,
removing_a_file_moves_it_to_the_trash,
open_accepts_only_folder_files_and_recorded_references,
symlinks_cannot_escape_the_item_folder,
urls_need_a_scheme_host_and_no_spaces}`;
  `links_tests::{a_link_is_stored_once_and_read_from_both_ends,
the_links_file_is_versioned_json_without_temporary_leftovers,
ids_are_validated_and_a_corrupt_file_is_not_overwritten}`.
- UI: `ItemFiles.test.tsx` (5), `ItemLinks.test.tsx` (3),
  `MeetingsHub.items.test.tsx` (Files tab named by date and title, linking
  from the inspector, Outlook-only meeting asks to prepare first),
  `WorkspaceItems.test.tsx` (activity files and meeting link from the side
  editor; a meeting's own note shows neither).
