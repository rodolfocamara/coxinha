# 0117 — Faces for people

Status: draft
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

### P1 Directory photo for invitees

- Invitees from the owner's tenant have a Microsoft 365 profile photo.
  After an explicit opt-in in Settings, the app asks for the delegated
  `User.ReadBasic.All` scope (no admin consent required, per the Microsoft
  Graph permissions reference) and fetches
  `/users/{mail}/photos/240x240/$value` for people imported from invitees.
- A photo is fetched once per person and refreshed at most weekly. A 404
  means no photo, and it is not asked again for that week.
- Photos live in the library's private folder, never in the vault, and
  leave with the person or with the opt-out.

### P2 Snapshot of the call window

- While a capture runs, the strip offers "Capturar participantes". It
  grabs one frame of the call's window (the pid from call detection):
  - Windows: `Windows.Graphics.Capture` for that window, without a picker.
  - Linux: the xdg-desktop-portal ScreenCast with a window source. The owner
    picks the window once, and the restore token (`persist_mode` 2) skips
    the picker on later calls while that grant holds.
  - macOS: ScreenCaptureKit, later.
- The frame goes to `raw/<meeting>/snapshots/` and leaves with the
  meeting, like its audio.

### P3 Tiles become photo suggestions

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

- [ ] With the opt-in off, no Graph photo request is made and no scope is
  asked. (calendar auth tests)
- [ ] An invitee's photo is fetched once, kept privately, and dropped with
  the person or the opt-out. (people photo tests)
- [ ] A snapshot is stored under the meeting and deleted with it, and the
  full frame is gone after cropping. (snapshot store tests)
- [ ] A label matching an invitee yields one dismissible suggestion on
  that person, and an unmatched label yields none. (tile matching tests)
- [ ] People and the speaker card show the accepted photo, else the
  directory photo, else initials. (UI tests)
