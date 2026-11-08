# 0110 — Name speakers by typing, and people from the calendar

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

The owner's first real review of "Falantes" (2026-11-03) found it hard to
use. Each speaker card repeats four help paragraphs, a select and a
verification field, so four speakers fill two screens. The select lists only
people already created, and the owner's library has none, so the list is
empty: naming a voice means leaving for "Adicionar pessoa", writing a
consent origin and coming back. The invitees of spec 0102 do not help either,
because the recordings made before Outlook was connected ("Meeting in Google
Chrome") have no participants stored, even when the list already shows them
next to their calendar event.

The owner asked for three things: type a name that does not exist yet,
autocomplete, and import the meetings' participants as people.

## Non-goals

- Naming a voice without a confirmation. Typing fills the field; the voice
  is named only by "Confirmar" (spec 0060 stays).
- Storing e-mail addresses on people. The person table has a name and
  aliases; e-mails only deduplicate the import.
- Voice enrollment. "Remember this voice" stays a separate, opt-in step
  after the confirmation (spec 0077).

## Design

### P1 One field per speaker (`PersonCombobox`)

- "Quem é?" is a text field with a list below it (WAI-ARIA combobox:
  arrows move, Enter picks, Escape closes). Matches ignore case, accents and
  spacing, on names and e-mails. The meeting's invitees come first with
  "· convidado(a)", then everyone else.
- Typing a name that is nobody yet offers "Criar pessoa “Nome”" as the last
  option. Confirming creates the person with the consent origin "Nomeado(a)
  por você ao revisar esta reunião" and names the voice in one step, as an
  invitee does in spec 0102.
- Typing the exact name of one person picks that person; two people with the
  same name must be picked from the list, where they show a short id.

### P2 One list, nothing else in the way

The owner's second review (2026-11-03) still found too much text under the
voices. Following the app-screen rules of the design skill (one question
per screen, the largest block answers it, everything else recedes):

- The tab answers "who is each voice?". Its header is the count ("4 vozes ·
  2 sem nome") with "Importar da agenda" on the right; no intro paragraph.
- The voices are one divided list, one row each: play button, name or "Sem
  nome", track and time as a grey subline, and "Quem é?" with "Confirmar".
- A first naming records "Ouvi o trecho e reconheci a voz" as the
  verification without asking. A named row shows only "Trocar"; it opens the
  field, a reason (required to correct or revoke), "Revogar" and voice
  memory.
- "Adicionar pessoa", the recognition status, voice profiles, the
  comparison and the processing details sit under one collapsed "Mais
  opções". Overlapping speech keeps its one grey line under the list.

### P3 The meeting's invitees from the calendar

- The meeting page passes the attendees and organizer of the calendar event
  it already shows for the session to the speaker review, merged with the
  stored participants (deduplicated by e-mail, then name).

### P4 Import people from the calendar (`library_import_people`)

- Pessoas gets "Importar da agenda". A sheet lists everyone invited to the
  cached calendar events (attendees and organizers, without the connected
  account), deduplicated by e-mail, then name, with how many meetings they
  were in, most frequent first, and a search. People who already exist are
  left out.
- All are checked; "Importar N pessoas" creates the checked ones with the
  consent origin "Participante de reuniões da sua agenda".
- The backend creates, in one transaction, only the names that no person
  has yet (case, accents and spacing ignored) and returns how many it
  created and skipped. At most 500 names per call.

## Acceptance

- [x] Typing filters people and invitees, Enter picks, an unknown name offers
      creation and confirming creates and names in one step
      (`personChoices` and `SpeakerCard.invitees` tests).
- [x] An exact single name resolves to that person; homonyms need a pick
      (`SpeakerCard` tests).
- [x] A first naming asks only the name; a named voice opens correction behind
      "Trocar" with an empty reason (`SpeakerCard` and `SpeakerReview` tests).
- [x] The calendar event's attendees reach the review (`SpeakerReview`
      tests).
- [x] Import lists calendar participants once, without existing people or
      the account, and creates the checked ones (`calendarParticipants` and `ImportPeopleSheet` tests).
- [x] The backend import skips existing and repeated names in one
      transaction (`identity::import` tests).
- [ ] Owner: a "Meeting in Google Chrome" recording named by typing, and the
      calendar imported into Pessoas.

## Evidence

- Rust (`cargo test -p coxinha-core --lib identity::import`, 3 tests):
  `names_fold_case_accents_and_spacing`,
  `import_skips_existing_and_repeated_names`, `a_bad_name_imports_nobody`.
- UI: `personChoices.test.ts` (4), `SpeakerCard.invitees.test.tsx` (7),
  `SpeakerReview.test.tsx` (calendar attendees merged once),
  `SpeakerReviewLifecycle.test.tsx` (homonyms need a pick),
  `calendarParticipants.test.ts` (1), `ImportPeopleSheet.test.tsx` (2),
  `PersonFormSheet.test.tsx` (import is the empty registry's first action).
