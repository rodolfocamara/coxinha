# 0092 — Global people and visible recording controls

Status: in-progress
Date: 2026-10-27

## User outcome

People and their confirmed voice samples form one local registry shared by all
meetings. The meeting view assigns its speakers to that registry and selects
samples for training. Recording controls must remain usable without opening a
device setup form.

## Acceptance

- Add a People & voices navigation entry and standalone route. It works without
  a selected meeting, recording, transcript or completed job. Reuse the private
  profiles/samples paginated APIs; no second registry, schema or embedding store.
- Create people with an explicit consent origin. Creation does not enroll audio
  or assign any meeting speaker. Guard duplicate in-flight mutations; retain
  drafts on failure. Success refreshes the directory from its first page.
- Show the existing paginated inventory expanded on the global page. Search is
  explicitly over loaded people only; loading more stays manual. Preserve stale
  cursor/generation handling, partial counts, sample history and explicit revoke.
- Keep the meeting's speaker assignments and selected enrollment intact. Label
  its tab Speakers and explain that profiles are global. The registry remains
  reachable from the sidebar even without recorded audio.
- Show Pause/Resume and Stop and save directly beside the current meeting's
  capture state, even when recording controls are collapsed. Never give controls
  for another meeting's capture. Maintain action single-flight and failure retry.
- Device selection and diagnostics remain available in the expandable setup.
  Avoid duplicate transport actions and large repeated capture headings. Retain
  duration, disk sizes, local folder and joint playback from spec 0091.
- Preserve data, recording/processing ownership, voice consent/revision guards,
  design tokens, keyboard behavior and English/pt-BR localization.

## Interface references

The scoped job is listening to or controlling a local meeting while keeping notes
visible. Amie's meeting detail is the primary structural example for compact audio
and metadata near the content:
https://mobbin.com/screens/c660e4c0-f122-428b-949d-8980d57b4527
Grain and Otter were inspected as alternatives, not copied:
https://mobbin.com/screens/d2cca56d-fc5b-4127-997f-d5cd5aabf2b3
https://mobbin.com/screens/0f065cf5-de05-4db5-bcd6-84da360ab416
The explicit global registry scope comes from the user's request, not a reference.

## Outlook decision boundary

The assistant's existing Outlook connector can read the signed-in calendars.
That connection is not an OAuth session the desktop application can inherit.
Supported Graph sign-in requires a registered public client; a product-owned
registration removes per-user registration work, but does not remove tenant
consent policies. Never use another application's client ID as the Coxinha identity.
An existing local calendar adapter or explicitly imported/exported calendar is a
possible bridge without a new Coxinha registration. A published ICS URL is
read-only and grants access to holders of that URL; it must not be published or
extracted implicitly. No browser cookie/token harvesting or tenant-policy bypass.
No Outlook account/calendar data is written by this frontend increment.

Sources checked 2026-10-27:
https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration
https://support.microsoft.com/en-us/outlook/share-your-calendar-in-outlook-on-the-web

## Validation

Test global access without a meeting/job, creation and single-flight/error drafts,
pagination/search honesty, no automatic enrollment, existing stale/revoke cases,
and visible owned Stop with collapsed device controls. Router tests verify entry
and selected navigation. Browser/native appearance and real capture remain
separate acceptance gates; do not call this OAuth integration or model calibration.
