# 0117 — Faces for people

Status: in-progress (P1 done; P2 and P3 later)
Phase: F1
Date: 2026-11-03

## Why

The owner meets many people once or twice and forgets who is who. People
(spec 0092) shows names and voices, never a face. During a Teams call the
face, or at least the avatar, sits on screen next to the name, and is gone
when the call ends.

## Non-goals

- Face recognition. No face embedding, matching or clustering. A photo is
  only shown next to a name the owner confirmed.
- Video recording, or a capture that runs on its own all call long.
- Sending images anywhere. Snapshots and photos stay on this computer.
- Reading the call's content (shared screens, chat). Only participant
  tiles are kept, and the full snapshot is deleted once cropped.

## Design

### P1 Directory photo for invitees (shipped)

- Invitees from the owner's tenant have a Microsoft 365 profile photo. A
  switch on the Agenda settings page starts a new sign-in that also asks for
  the delegated `User.ReadBasic.All` scope. Only a granted scope turns the
  opt-in on. A normal sign-in and every refresh never ask for it.
- Graph addresses a user by id or UPN, not by mail, and the two can differ.
  So each person takes two requests: `GET /users?$filter=mail eq '{mail}'`,
  then `GET /users/{id}/photos/240x240/$value`.
- The lookup is also the tenant check: only the owner's directory answers. No
  result, several results or a guest (`#EXT#` in the UPN) means no photo
  request. The mail goes only to the Microsoft tenant that already holds the
  event.
- Candidates are people whose origin is an invitee import (specs 0102, 0110).
  People hold no mail, so it comes from the cached agenda by name. A name with
  two mails is skipped: no photo is better than someone else's face.
- A person is checked once and refreshed at most weekly. A 404 means no photo,
  and it is not asked again for that week. A person whose photo is smaller than
  240x240 also answers 404 and shows initials.
- A 403, a rejected token or a missing scope stops every request and shows in
  Settings until the owner signs in again; nothing retries it. A 429, a 5xx or a
  network failure ends the pass, which waits at least an hour or `Retry-After`.
- Photos live in `private/photos/`, beside `private/profiles.db`, never in the
  vault. Only JPEG and PNG up to 5 MB are kept. The UI asks by person id and
  receives a `data:` URL, never a path.
- Photos leave with the person, with the opt-out and with disconnecting
  Outlook or changing account. The app has no way to delete a person yet; the
  foreign key and the sweep already cover it.
- The opt-out cannot revoke the consent itself: it stays in the owner's
  Microsoft account until removed in My Apps. With the opt-in off the app
  makes no photo request even if the token still carries the scope.
- People, the speaker card, the meeting inspector and invitee lists show the
  photo, else initials. Invitee lists match by name, like spec 0102, so a
  namesake who appears after the check shows the same photo.

Checked against Microsoft Graph docs on 2026-11-04:

- [Get profilePhoto](https://learn.microsoft.com/en-us/graph/api/profilephoto-get?view=graph-rest-1.0):
  240x240 is a supported size, and 404 means no photo. Its table calls
  `ProfilePhoto.Read.All` least privileged and lists `User.ReadBasic.All` as
  higher privileged.
- [Permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference):
  `ProfilePhoto.Read.All` needs admin consent; delegated `User.ReadBasic.All`
  does not, and its basic profile includes the photo. A tenant can still
  restrict user consent, which shows here as a refusal.
- [List users](https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0):
  `User.ReadBasic.All` is the least privileged scope for the lookup, which
  `ProfilePhoto.Read.All` would not cover.

### P2 Snapshot of the call window (later)

Not implemented.

- While a capture runs, the strip offers "Capturar participantes". It
  grabs one frame of the call's window (the pid from call detection):
  - Windows: `Windows.Graphics.Capture` for that window, without a picker.
  - Linux: the xdg-desktop-portal ScreenCast with a window source. The owner
    picks the window once, and the restore token (`persist_mode` 2) skips
    the picker on later calls while that grant holds.
  - macOS: ScreenCaptureKit, later.
- The frame goes to `raw/<meeting>/snapshots/` and leaves with the
  meeting, like its audio.

### P3 Tiles become photo suggestions (later)

Not implemented.

- Local OCR (Windows.Media.Ocr on Windows; an open question on Linux)
  reads the name labels in the frame. Each label that matches an invitee
  or a known person, by the same name matching as spec 0102, yields the
  tile around it as a cropped image.
- Each crop is a suggestion on the person ("Visto em <meeting>"), labelled
  as such and dismissible (ADR 0015). Accepting it makes it the person's
  photo, ahead of the directory photo. The full frame is deleted after
  cropping.

## Open questions

1. OCR on Linux: Tesseract (system package) or an ONNX text model shipped
   like the speaker models.
2. Tile bounds: Teams changes layout (gallery, speaker, a shared screen
   with a thin strip). The first cut takes a fixed box above the label,
   sized from the label height. Whether that holds across layouts needs
   frames from real calls.
3. Later: Teams outlines the speaking tile. Matching that outline in
   snapshots with diarized turns could suggest which voice is which
   person. Out of scope here.

## Acceptance criteria

### P1

- [x] With the opt-in off, no Graph photo request is made and no scope is
  asked. (`calendar::photos` tests, `identity::photos` tests)
- [x] An invitee's photo is fetched once, refreshed at most weekly, kept
  privately, and dropped with the person or the opt-out. (`calendar::photos`
  and `identity::photos` tests)
- [x] A 404 is not asked again for that week; a 403 or a missing consent is
  visible and does not retry. (`calendar::photos` tests,
  `DirectoryPhotosRow.test.tsx`)
- [x] People, the speaker card and invitee lists show the directory photo, else
  initials. (`personPhotos.test.tsx`, `tools/ui-preview/person-photos.mjs`)
- [x] The image source loads in WebKitGTK under the app's CSP.
  (`tools/ui-preview/person-photos-webkitgtk.py`)

### Later (P2, P3)

- [ ] A snapshot is stored under the meeting and deleted with it, and the
  full frame is gone after cropping. (snapshot store tests)
- [ ] A label matching an invitee yields one dismissible suggestion on
  that person, and an unmatched label yields none. (tile matching tests)
- [ ] People and the speaker card show an accepted suggestion ahead of the
  directory photo. (UI tests)
