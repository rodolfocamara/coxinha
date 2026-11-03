# 0116 — Multilingual live transcript

Status: in-progress
Phase: F1
Date: 2026-11-03

## Why

The live transcript (spec 0097 P3) runs Tagarela, a Parakeet fine-tuned on
pt-BR. On English speech it does not fail visibly: it writes made-up
Portuguese. The owner's meetings mix Portuguese and English, often within
the same call. A local benchmark on 2026-11-03 (two-minute clips from the
owner's own meetings, 30 s windows, 8 threads) compared the local models:

| Model | RTF | English | Portuguese |
|---|---|---|---|
| Tagarela (matched q8) | 0.11 | invented Portuguese | best |
| Parakeet Ultra (Q8_0) | 0.11 | good, keeps code-switching | worse than Tagarela |
| Qwen3-ASR 1.7B (Q8_0) | 0.35–0.42 | best | drops phrases |

Parakeet Ultra (Moondream, CC-BY-4.0, 25 languages) is as fast as Tagarela.
Transcribe.cpp 0.2.4 returns no language for it, so the routing below reads
the decoded text. Routed over 10 s windows on 4 threads, the pair ran at RTF
0.11 on the same clips: English kept, Portuguese windows from Tagarela.

## Non-goals

- Translation. Each window keeps the language it was spoken in.
- A language choice per meeting, or a model picker. Routing is automatic.
- Re-running old live transcripts. New windows use the new routing.
- Manual processing engines (whisper, transcribe-rs). They keep their own
  models.

## Design

### P1 Each window goes to the multilingual model first

- When the configured model is Tagarela and a multilingual Parakeet (Ultra
  first, then v3) sits in the same folder or in Handy's folder,
  the multilingual model decodes every window and Tagarela becomes the
  Portuguese pass. When the configured model is multilingual, a Tagarela in
  Handy's folder or the same folder becomes its Portuguese pass.
- With only one model available, it runs alone, as before.
- Both models load on the worker thread and unload together when idle.

### P2 Portuguese windows are decoded again by Tagarela

- A window is decoded again by Tagarela, and Tagarela's words replace it,
  unless its multilingual text has more English than Portuguese marker
  words (function words; any word with ã, õ, ç, â, ê or ô counts as
  Portuguese). The owner speaks Portuguese, and the multilingual model
  writes their speech as gibberish in other languages, with no English
  markers ("Det kan sue big infir om visibraciones" in the benchmark).
- A window with no words keeps the multilingual result.
- Only the decoded text is read; nothing is stored about the language.

## Acceptance criteria

- [ ] English and Portuguese sentences from the owner's meetings are told
  apart, gibberish and ties go to the Portuguese pass, and an empty window
  keeps the multilingual result.
  (`live::language` tests)
- [ ] A Portuguese window returns the Portuguese pass's words and an English
  window returns the multilingual words, without calling the Portuguese
  pass. (`live::routed` tests)
- [ ] A configured Tagarela pairs with a Parakeet Ultra next to it, a
  configured Ultra pairs with a Tagarela, and a lone model runs alone.
  (`speech_models` tests)
