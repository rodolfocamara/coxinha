# 0132 — Fixes from the first Windows validation

Status: in-progress
Phase: F1
Date: 2026-11-08

## Why

The release build was installed and exercised on Windows 11 (NSIS and MSI, silent
install and uninstall, launch, global chords, notes, exit). Installation and the app
worked. These problems showed up, and two of them also exist on Linux.

## Non-goals

- Windows capture itself (spec 0133).
- Code signing and SmartScreen.
- Deleting data from a silent or MSI uninstall.

## Design

### P1 Unsupported, not "no microphone"

Where the backend has no capture adapter, `library_sources` answers
`capture adapter unavailable on this platform`. The recorder said "Could not list
audio devices." The failure is now `unsupported`: "Recording is not available on
this system yet." Settings shows the same notice instead of an empty device list.

### P2 No ghost meeting

The record button and chord created an `active` meeting before checking devices,
and a failed start left it "under way" on Hoje. Devices are listed again before each start (one may have come or gone);
without them no meeting is created. A second press while the first is still
checking does nothing. If the start itself fails, the meeting created for it
becomes `cancelled`. Settings also relists devices on every visit.

### P3 The window fits the screen

The 1200x800 window was taller than the work area of a 1280x800 screen, so the
taskbar covered the bottom of the rail. Before the first show, the window shrinks
to the monitor's work area and is centred in it.

### P4 Opening a note puts the caret in it

A note opened through the URL (new-note chord, palette, Hoje) got no editor focus,
so typing went nowhere until a click. Such an opening now carries the same explicit
focus request a board creation does. Local board selection still never steals focus.

### P5 Agenda and meetings chords differ

Both chords opened the same calendar. The agenda chord ("Open today's agenda") now
opens one day, today, in the day view; the meetings chord opens the remembered view.

### P6 Uninstall asks about data, keeps it by default

NSIS already offers "Delete the application data", unchecked. When it is checked in
an interactive uninstall, a second question asks about notes and recordings in the
default vault (`%USERPROFILE%\coxinha`), with "No" as the default. The question
follows the installer language; the installer now ships English and Brazilian
Portuguese. Silent and MSI uninstalls keep everything; removing it is a manual step.

## Acceptance

1. Unsupported platform: `unsupported` failure and no meeting created. (unit)
2. Missing device: `devicesMissing` and no meeting created; a double press creates
   one meeting. (unit)
3. Failed start: the created meeting becomes `cancelled`. (unit)
4. Window larger than the work area is fitted and centred. (unit: fit maths; manual:
   Windows 1280x800)
5. A note opened from the URL receives a focus request. (unit; manual: Windows chord)
6. Agenda chord opens today in a one-day view, meetings chord the remembered view.
   (unit)
7. Interactive NSIS uninstall with the box checked asks about the vault, default No;
   unchecked or silent keeps it; the question is in Portuguese on a pt-BR system.
   (manual: Windows VM)
