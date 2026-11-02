# 0102 — Name speakers from the meeting's invitees

Status: in-progress
Phase: F1
Date: 2026-11-02

## Why

Automatic separation (specs 0099 and 0101) leaves every meeting with
anonymous voices (`speaker-2`, `speaker-3`…). Naming one in "Falantes" works,
but the person picker lists only people already created, while the names the
owner expects are the meeting's invitees, which arrive from the calendar
(spec 0097, spec 0100). Using an invitee today means opening "Adicionar
pessoa", copying the name, writing a consent origin, closing, picking the new
person and then writing how the identity was verified.

## Non-goals

- Assigning a name without a confirmation. Invitees only fill the picker;
  order, speaking time or invitation never decide who a voice is
  (spec 0060 stays).
- Recognizing voices in other meetings. That still needs selected samples
  and a calibration policy (specs 0060, 0078).
- Carrying names over when a meeting is separated again by a new engine.

## Design

### P1 Invitees in the picker (`SpeakerCard`)

- The review loads the meeting's participants once and passes them to each
  speaker card.
- The picker lists the invitees first, then everyone else. An invitee whose
  name matches an existing person (case, accents and spacing ignored) is that
  person, so nobody is created twice. Other invitees show "· convidado(a)".
- Confirming an invitee who is not a person yet creates the person, with the
  consent origin "Convidado(a) desta reunião na agenda", then confirms the
  voice as one step.

### P2 Verification prefilled

- "Como você verificou esta identidade?" starts with "Ouvi o trecho e
  reconheci a voz" for a voice without a name. The owner can edit it; an
  empty field still blocks the confirmation. A named voice starts empty, so
  a correction or revocation gets its own reason.

## Acceptance

- [ ] Invitees come first in the picker; one matching an existing person is
      not duplicated (`SpeakerCard.invitees` tests).
- [ ] Confirming an invitee creates the person with the calendar consent
      origin and confirms the voice with the prefilled verification
      (`SpeakerCard.invitees` tests).
- [ ] The review passes the meeting's participants to the cards
      (`SpeakerReview` tests).
- [ ] Owner's library: a separated meeting named from its invitees.
