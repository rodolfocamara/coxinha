# 0130 — Respond to invites

Status: in-progress
Phase: F1
Date: 2026-11-04

## Why

Coxinha's agenda is becoming the owner's daily replacement for Outlook's calendar
screen, and an invitation still has to be answered in Outlook. This is step 2 of
`docs/research/2026-11-03-outlook-calendar-parity.md`: accept, tentative, decline
and propose a new time, with a comment, silently, for one occurrence or a series.

It is the first feature that reaches other people, and a response cannot be
recalled. So nothing leaves before the owner has seen who receives what, and a
failure is never hidden or queued.

## Non-goals

- A pending invites inbox, forwarding, editing own events, organizing meetings.
- Offline sending. A response that cannot go now fails where the owner can see it.
- Accepting a time someone else proposed (organizer side).
- Telling the owner's copy of the invitee list about the answer. The cache knows the
  account only by its OIDC subject, not its address, so the Invited counts catch up
  on the next refresh. The owner's own Response row is immediate.

## Design

### P1 What Graph says

Checked on 2026-11-04 against Microsoft's docs:
[accept](https://learn.microsoft.com/graph/api/event-accept),
[tentativelyAccept](https://learn.microsoft.com/graph/api/event-tentativelyaccept),
[decline](https://learn.microsoft.com/graph/api/event-decline),
[propose new times](https://learn.microsoft.com/graph/outlook-calendar-meeting-proposals),
[event](https://learn.microsoft.com/graph/api/resources/event),
[dateTimeTimeZone](https://learn.microsoft.com/graph/api/resources/datetimetimezone),
[responseStatus](https://learn.microsoft.com/graph/api/resources/responsestatus),
[immutable IDs](https://learn.microsoft.com/graph/outlook-immutable-id).

| | `accept` | `tentativelyAccept` | `decline` |
| --- | --- | --- | --- |
| Request | `POST /me/events/{id}/accept` | `POST /me/events/{id}/tentativelyAccept` | `POST /me/events/{id}/decline` |
| `comment`, optional | yes | yes | yes |
| `sendResponse`, optional, default `true` | yes | yes | yes |
| `proposedNewTime`, optional | not a parameter | yes | yes |
| Least privileged delegated scope | `Calendars.ReadWrite` | `Calendars.ReadWrite` | `Calendars.ReadWrite` |
| Success | `202`, empty body | `202`, empty body | `202`, empty body |

- **Scope.** `Calendars.ReadWrite` is the least privileged scope for all three and it
  is enough. `AUTHORIZE_SCOPE` already asks for it, so no new consent is needed. A
  connection from before spec 0103 lacks it: the token's `scope` tells us before any
  request, and a `401` or `403` tells us otherwise. Both end in "reconnect", as for categories.
- **Where Graph limits it.** `proposedNewTime` returns `400` when `sendResponse` is
  `false` or the event's `allowNewTimeProposals` is `false`. So a proposal always
  notifies the organizer, and an event that forbids it does not offer it.
- **`202`** means accepted for processing, and the docs do not say when a later read
  reflects it. See P6.
- **IDs.** The cache holds immutable IDs (`Prefer: IdType="ImmutableId"`, spec 0103),
  and the header applies per request, so the POST sends it too.

### P2 New fields

The sync adds `allowNewTimeProposals` and `responseRequested` to its `$select`. Both
are optional when parsed and `#[serde(default)]` in the cache. Docs give `true` as the
default of both, so an absent value counts as `true` until the next refresh; a refusal
from Graph then shows as any other failure.

### P3 Who can respond

Only an invitee. `canRespond` needs `myResponse` of spec 0126 to be accepted, tentative,
declined or none (so not organizer and not a personal block), a known organizer and
an event that is not cancelled. The backend applies the same rule to the cached event:
the window names an event, and the URL is built from the cache, never from the window.

Past meetings keep the action, as in Outlook. Nothing about them is less reversible
than the rest, and the preview says what goes out.

### P4 The flow

The Response row of the property sheet (peek and inspector) shows the current answer
with one action, "Respond" or "Change". It opens a `Sheet`, in two steps:

1. **Compose.** Accept, tentative, decline or propose a new time; for a recurring event,
   this occurrence or the whole series; an optional comment; notify the organizer or
   not. Nothing here talks to the network.
2. **Review.** Who receives it (the organizer's name and address), the response, the
   comment, the proposed time and its zone, what it applies to, and that it cannot be
   recalled. With notifying off it says the organizer is told nothing and only the
   owner's calendar changes. Sending is the only button that sends, and its label names
   the recipient.

While sending, the sheet stays open and cannot close: the result must be seen. There is
no optimistic state: the row changes after Graph answers `202`.

Rules that follow from Graph and from what the owner would expect:

- Notifying off hides the comment, and the backend drops it: it would reach nobody.
- `responseRequested: false` starts with notifying off and says so. The owner can
  still turn it on. The docs do not say what Graph does then; a refusal is a failure.
- A proposal is sent as tentative or decline, as in Outlook ("Tentative and propose
  new time"). `accept` has no such parameter.
- A proposal is for one occurrence: a proposed slot names one date, which has no meaning
  across a series. The docs do not forbid it on a master; Coxinha does not offer it.

### P5 Occurrence or series

`seriesMasterId` marks a recurring event. "This occurrence" posts to the cached event's
own id, and "Whole series" to `seriesMasterId`, also from the cache. A single event has
no choice to make and the review says "this meeting".

The docs do not describe how a response on a master treats an occurrence edited on its
own (an exception). The cache marks every cached event of the series, and the next
refresh corrects any that Exchange treated differently.

### P6 Sending, failure and the cache

`calendar_respond(eventId, request)` holds the calendar operation lock like every
other write. On `202` it updates the cached event, or every cached event of the series,
saves the cache and returns the snapshot. Open views re-read it at once.

- The cached `response` changes, and `showAs` follows: tentative becomes `tentative`,
  and accepting a tentative block becomes `busy`. So the block's look changes too.
- A declined event stays cached, marked declined, until the refresh says otherwise.
  Exchange may remove it from the calendar; the docs do not state it for `decline`.
- A refresh right after a `202` could read the old answer if Exchange has not applied
  it, and the row would go back until the next refresh. Not reproducible without a
  real invite; see the acceptance list.
- Once Graph has answered `202`, failing to save the cache does not read as failure: a
  retry would send a second message. It is logged and the next refresh corrects it.

| What happened | Code | Offers retry | Says |
| --- | --- | --- | --- |
| No connection reached Graph | `calendar.respondOffline` | yes | Nothing was sent |
| Timeout or a broken connection after sending | `calendar.respondUncertain` | yes | It may have arrived: check first |
| `401`, `403`, or the token lacks the scope | `calendar.respondReconnect` | yes | Reconnect in Settings |
| `404` | `calendar.eventMissing` | yes | Gone from the calendar |
| `400` | `calendar.respondRejected` | yes | Outlook refused it |
| Any other status (`429`, `5xx`) | `calendar.respondFailed` | yes | Not accepted |
| Refresh failed before sending | existing codes | yes | Nothing was sent |

Nothing is queued: a failure leaves the review open with what was typed, and a retry is
the owner's own action. Provider bodies never reach an error, and the comment is never
logged. Responses are not idempotent on Graph's side, so the buttons lock while sending.

### P7 Time zones

The proposal is typed and shown in the computer's zone, the one the whole agenda uses,
with the zone next to the fields and in the review: "America/Sao_Paulo (GMT-3)".

On the wire it is UTC, as in spec 0104 P5. The docs list the accepted zones (Windows
names plus a partial IANA list) and warn that methods may not support all of them, and
a browser's IANA name may not be on it (`America/Recife` is not). The organizer's client
shows the slot in their own zone either way. A slot must end after it starts, last at
most 14 days, not be in the past, and differ from the meeting's current time.

### P8 Accessibility and language

Native radios in fieldsets, a labelled checkbox and `Field`s. Moving between steps moves
focus to the step's first control or heading. Errors use `role="alert"`, and the note
after success is a `role="status"` in the row. All strings exist in en and pt-BR.

## Acceptance criteria

- [x] URL and body for accept, tentative and decline, on an occurrence and on a series,
      with and without comment, silently, and for a proposal in UTC
      (`calendar/respond_tests.rs`).
- [x] Refused before any request: organizer, cancelled, personal block, no organizer,
      series without a master, proposal with accept, on a series, silently, or where
      forbidden; long comment; bad, past or overlong slot (`respond_tests.rs`).
- [x] The POST on the wire, against a local server only: method, path, bearer, `Prefer`,
      content type and body (`respond_tests.rs`).
- [x] `202` succeeds; `400`, `401`, `403`, `404`, `429`, `500` and a refused connection map
      to the codes of P6 (`respond_tests.rs`).
- [x] The cache changes for the event or the whole series, `showAs` follows, and an
      older cache still loads (`respond_tests.rs`, `graph_tests.rs`).
- [x] The action appears only for an invitee of an event that is not cancelled, and the
      current response is visible (`respondModel.test.ts`, `MeetingDetail.respond.test.tsx`).
- [x] Nothing is sent before the second action; the review names recipient, response,
      comment, proposed time with zone and scope (`MeetingDetail.respond.test.tsx`).
- [x] Notifying off, a proposal's limits, and an event that forbids proposals
      (`MeetingDetail.respond.test.tsx`, `respondModel.test.ts`).
- [x] A failure stays visible with what was typed, a retry sends once more, and the
      row changes only after success (`MeetingDetail.respond.test.tsx`).
- [x] Real browser: both themes and languages, three font sizes, 800×600 included, no
      overflow, keyboard only from the row to sending, nothing sent before the second
      action, failure and retry (`tools/ui-preview/respond-invite.mjs`), WebKitGTK
      included (`tools/ui-preview/webkitgtk-audit.py`, screen `respond`).
- [ ] Owner: answer a real invite of each kind and see it in Outlook. Needs a real
      invite, and also settles: what the organizer receives, how a response on a master
      treats an exception, whether a read right after `202` shows the answer, whether a
      declined event leaves the calendar, and what `responseRequested: false` does with
      `sendResponse: true`.

## Evidence

Run on 2026-11-04 against the mocked IPC, with no request to Microsoft Graph:
`tools/ui-preview/respond-invite.mjs` over 24 combinations of language, theme, font size
and window, plus keyboard, Escape, failure and availability, ended with 0 findings;
`tools/ui-preview/meeting-detail.mjs`, with the new `invite` state, 13 states and 0
findings; `tools/ui-preview/webkitgtk-audit.py --screens respond` on WebKitGTK 2.54.2, 12
screens and 0 issues. Its offscreen snapshot draws the week grid's scrollbar over the
sheet, and the line goes when the grid is hidden; the sheet's own layout has no overflow.
