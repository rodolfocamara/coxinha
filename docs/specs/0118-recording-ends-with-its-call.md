# 0118 — A recording ends with its call

Status: in-progress
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
  same as starting automatically. It works with automatic recording off;
  it needs call detection on, which is the default.
- A call that is active while none of the followed calls is joins them, so
  a recording never stops in the middle of a call. With automatic recording
  on, a recording it started still splits at a new call (spec 0097
  back-to-back).

### P2 It stops on its own after a quiet minute

- When none of the followed calls has been active for 60 s, and the
  microphone stayed quiet in that minute (every 1 s peak at or below 0.08),
  the capture stops. This replaces the 20 s grace of spec 0097 for
  recordings automatic recording started.
- Speech on the microphone restarts the minute, so a conversation that goes
  on in the room keeps recording.
- A followed call that comes back cancels the stop. "Continuar gravando"
  in the strip cancels it for this recording.
- "Parar quando a chamada terminar" (spec 0097 setting, on by default)
  turns P2 off for every recording. The setting shows with automatic
  recording off too.
- A failed detector poll restarts the minute: unreliable evidence never
  counts toward an ending.
- While the minute runs the strip shows the countdown of spec 0097, with
  "Parar agora" and "Continuar gravando".

### P3 The owner is told afterwards

- A native notice says "Gravação encerrada" / "O Coxinha parou junto com a
  chamada no {app}.", through the same critical-urgency path as the call-end
  notice of spec 0115. The strip shows the same line, with the recording's
  link, until the next capture or until dismissed.
- The "A chamada terminou?" notice and the strip prompt of spec 0115 stay
  quiet when P2 will stop the recording; they still ask when the setting is
  off or the owner chose "Continuar gravando".
- The silence prompt of spec 0114 still asks: P2 only acts on the call's
  end, not on a silent call that is still detected.

## Acceptance criteria

- [ ] A manual capture started during a call stops 60 s after the call
  ends with a quiet microphone, with automatic recording off.
  (`auto_record::policy` tests)
- [ ] Microphone speech in that minute postpones the stop, and the call
  coming back cancels it. (policy tests)
- [ ] A capture with no call never stops on its own, the setting off never
  stops one, and "Continuar gravando" cancels it. (policy tests)
- [ ] A call that starts while no followed call is active joins the follow.
  (policy tests)
- [ ] The stop is commanded once, so the notice is raised once, and the
  0115 ask stays quiet when the stop is automatic.
  (policy tests, `call_detector` tests)
- [ ] The library reports how long ago the microphone last carried speech.
  (`library` tests)
- [ ] The strip shows the countdown for a manual recording and the
  "stopped with the call" line afterwards. (`autoRecord.test.tsx`)
- [ ] Owner: a Teams call recorded by hand stops about a minute after it
  ends, and the notice shows.
