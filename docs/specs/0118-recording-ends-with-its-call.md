# 0118 — A recording ends with its call

Status: draft
Phase: F1
Date: 2026-11-03

## Why

Three Teams calls in Chrome on 2026-11-03, all recorded by hand:

| Call | Remote audio stopped | Detector "call ended" | Owner stopped |
|---|---|---|---|
| Unscheduled | 15:00:12 | 15:00:21 | 15:01:41 |
| AI Talk 2 | 16:43:38 | 16:43:43 | 16:44:28 |
| Pulso MX | 18:26:14 | 18:26:22 | 18:30:14 |

Detection works: the end is known 5 to 9 s after the last remote word.
Every signal that needs the owner's attention failed: the strip prompt
(spec 0114), the window raise and the native notice (spec 0115 P1, critical
urgency since the third call). After a call the owner is already elsewhere.
Automatic stopping exists (spec 0097), but only for recordings automatic
recording started, and the owner records by hand.

On the owner's headset, the microphone's 1 s peaks stayed at or below 0.03
in the minute after each call, and above 0.08 in 53 of 60 seconds of their
speech during the last call.

## Non-goals

- Recordings made with no call detected (in person) never stop on their
  own.
- Window titles, URLs or the meeting's content as signals.
- Trimming the tail of a recording.

## Design

### P1 Every recording made during a call follows that call

- A capture that starts while calls are active, or during which the first
  call starts, follows those calls by app and process (not by episode,
  so a reconnect of the same call still counts).
- Starting by hand, from the strip, the shortcut or the calendar, is the
  same as starting automatically.

### P2 It stops on its own after a quiet minute

- When none of the followed calls has been active for 60 s, and the
  microphone stayed quiet in that minute (every 1 s peak at or below 0.08),
  the capture stops.
- Speech on the microphone restarts the minute, so a conversation that goes
  on in the room keeps recording.
- A followed call that comes back cancels the stop. "Continuar gravando"
  in the strip cancels it for this recording.
- "Parar quando a chamada terminar" (spec 0097 setting, on by default)
  turns P2 off for every recording.

### P3 The owner is told afterwards

- A native notice says "Gravação encerrada" / "O Coxinha parou junto com a
  chamada no {app}." The strip shows the same line, with the recording's
  link.

## Acceptance criteria

- [ ] A manual capture started during a call stops 60 s after the call
  ends with a quiet microphone. (`auto_record::policy` tests)
- [ ] Microphone speech in that minute postpones the stop, and the call
  coming back cancels it. (policy tests)
- [ ] A capture with no call never stops on its own, and the setting off
  never stops one. (policy tests)
- [ ] The stop raises the notice once. (auto_record tests)
