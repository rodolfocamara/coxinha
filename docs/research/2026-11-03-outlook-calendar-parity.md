# Outlook calendar parity

Date: 2026-11-03. Scope: what Outlook's calendar does, what Coxinha does today, and
what Microsoft Graph allows. Sources: Coxinha's code at `72fe56c`, and the Microsoft
Graph docs on the [event resource](https://learn.microsoft.com/graph/api/resources/event),
the [calendar API overview](https://learn.microsoft.com/graph/outlook-calendar-concept-overview),
[tentativelyAccept](https://learn.microsoft.com/graph/api/event-tentativelyaccept),
[getSchedule](https://learn.microsoft.com/graph/api/calendar-getschedule),
[free/busy](https://learn.microsoft.com/graph/outlook-get-free-busy-schedule) and
[calendar sharing](https://learn.microsoft.com/exchange/sharing/manage-calendar-delegate-access).
The feature list comes from those docs and from general product knowledge of Outlook;
no Outlook client was inspected. Effort is a rough guess, not an estimate.

## Recommendation

Replacing Outlook's calendar screen for daily use is feasible: nearly every feature has
a Graph API, and `Calendars.ReadWrite` is already requested. Exchange stays the source
of truth, so invites, phones and colleagues keep working. Replacing Outlook altogether
is not a goal: mail, the phone app and reminders while Coxinha is closed stay there.

Build in this order:

1. **Read what is missing.** A wider date range, response status, location, Teams link,
   body, free/busy, and faster sync. It sends nothing to anyone.
2. **Respond.** Accept, tentative, decline and propose a new time.
3. **Change your own events.** Move, resize, edit, delete.
4. **Organize.** Invite people, Teams link, rooms, recurrence, find a time, cancel.

## Blocking gaps today

- **Range.** Sync reads 30 days back and 30 ahead (`calendar/graph.rs`). Later weeks show
  empty, which is misleading once Outlook is closed.
- **Sync delay.** A refresh runs every 15 minutes, so a new invite can take that long.
  Delta query reduces the cost of a shorter interval.
- **Fields.** Only subject, times, cancelled, all-day, attendees, organizer, series ids and
  categories are read. Own response, location, join link and body are not.
- **Reminders.** Coxinha has no event reminders. Outlook's fire only where Outlook runs.

## Feature map

Status: done, partial or missing in Coxinha. All scopes are delegated. "have" means
`Calendars.ReadWrite` or `MailboxSettings.Read`, which Coxinha already requests. Only the
scopes of `tentativelyAccept`, `getSchedule`, `reminderView`, `findMeetingTimes` and calendar
sharing were checked one by one; confirm the others when specifying each feature.

### Viewing

| Feature | Coxinha | Graph | Scope | Effort |
|---|---|---|---|---|
| Day, work week, week, month | done | n/a | n/a | n/a |
| N-day view, mini month, today line | done | n/a | n/a | n/a |
| Extra time zones | done | not readable from Outlook | n/a | n/a |
| Category colours and filter | done | `masterCategories` | `MailboxSettings.Read` | n/a |
| All-day row | done | `isAllDay` | have | n/a |
| Any date range | partial (±30 days) | `calendarView` by range | have | S |
| Own response on the block | missing | `responseStatus` | have | S |
| Busy, free, tentative, away styling | missing | `showAs` | have | S |
| Attendee responses | missing | `attendees[].status` | have | S |
| Location | missing | `location`, `locations` | have | S |
| Teams join button | missing | `onlineMeeting.joinUrl` | have | S |
| Event body | missing | `body`, `bodyPreview` | have | S |
| Attachments | missing | `attachments` | have | M |
| Private events | missing | `sensitivity` | have | S |
| Open in Outlook | missing | `webLink` | have | S |
| Several own calendars, overlay | missing | `/me/calendars` | have | M |
| Shared or delegated calendars | missing | `/users/{id}/calendar` | `Calendars.Read.Shared` | M |
| Share your calendar | missing | `calendarPermission` | have | M |
| Group calendars | missing | `/groups/{id}/calendar` | `Group.Read.All`, admin consent | M |
| Colleague free/busy | missing | `getSchedule` | have | M |
| Working hours | missing | `mailboxSettings.workingHours` | have | S |
| Holiday, birthday calendars | partial (as events) | ordinary calendars | have | S |
| Scheduling polls (FindTime) | missing | not checked | n/a | n/a |

### Responding to invites

| Feature | Coxinha | Graph | Scope | Effort |
|---|---|---|---|---|
| Accept, tentative, decline | missing | `accept`, `tentativelyAccept`, `decline` | have | S |
| Comment, respond silently | missing | `comment`, `sendResponse` | have | S |
| Propose a new time | missing | `proposedNewTime` | have | S |
| One occurrence or whole series | missing | occurrence id or `seriesMasterId` | have | S |
| Forward an invite | missing | `forward` | have | S |
| Pending invites inbox | missing | `responseStatus` filter | have | S |

### Your own events

| Feature | Coxinha | Graph | Scope | Effort |
|---|---|---|---|---|
| Create by selecting on the grid | partial (subject, times) | `POST /me/events` | have | n/a |
| Set category | done | `PATCH` | have | n/a |
| Edit title, times, location, body | missing | `PATCH` | have | M |
| Drag to move, resize | missing | `PATCH` | have | M |
| Delete | missing | `DELETE` | have | S |
| Show as, private, importance | missing | `showAs`, `sensitivity`, `importance` | have | S |
| Set the reminder time | missing | `reminderMinutesBeforeStart` | have | S |
| Add attachments | missing | `POST attachments` | have | M |
| Create a series, edit one or all | missing | `recurrence`, `instances` | have | L |

### Organizing meetings

These send messages to other people, so each needs a clear preview and confirmation.

| Feature | Coxinha | Graph | Scope | Effort |
|---|---|---|---|---|
| Invite attendees, required or optional | missing | `attendees` | have | M |
| People picker | partial (local People) | `/me/people`, `/users` | `People.Read`, `User.ReadBasic.All` | M |
| Teams meeting | missing | `isOnlineMeeting`, `onlineMeetingProvider` | have | S |
| Scheduling assistant | missing | `getSchedule` | have | L |
| Suggest a time | missing | `findMeetingTimes` | `Calendars.Read.Shared` | M |
| Book a room | missing | `/places/microsoft.graph.room` | `Place.Read.All` | M |
| Cancel with a message | missing | `cancel` | have | S |
| Update attendees on change | missing | automatic on `PATCH` | have | S |
| Accept a proposed time | missing | `PATCH` start and end | have | M |
| Hide attendees, no forwarding, responses off | missing | `hideAttendees`, `responseRequested` | have | S |

### Reminders and awareness

| Feature | Coxinha | Graph | Scope | Effort |
|---|---|---|---|---|
| Reminder before a meeting | missing | `reminderView` | have | M |
| Snooze, dismiss | missing | `snoozeReminder`, `dismissReminder` | have | S |
| Faster change detection | partial (15 min poll) | `delta` | have | M |
| Push notifications | not planned | webhooks need a public endpoint | n/a | n/a |
| Out of office | missing | `mailboxSettings.automaticRepliesSetting` | `MailboxSettings.ReadWrite` | M |

### Stays in Outlook

| Feature | Why |
|---|---|
| Mail, including invite messages | outside this product |
| Phone app, reminders while Coxinha is closed | Coxinha runs on this computer |
| Setting up a full delegate | Microsoft's docs prefer doing it in Outlook, signed in as the owner |
| Print and export views | not requested |

## What Coxinha already does that Outlook does not

Recordings and transcripts on the agenda, notes and files per meeting, speakers by voice,
offline local data, and one search across all of it.

## Constraints

- **Outward actions.** A response, invite or cancellation reaches other people and cannot
  be recalled. Each must show who gets what before sending.
- **Consent.** `Calendars.ReadWrite` and `MailboxSettings.Read` are already requested. Scopes
  outside "have" need a reconnect, and the tenant may require an admin to approve them.
- **Offline.** Writes need the network. Failures must be visible, never silently queued.
- **Recurrence.** Series with exceptions are the largest risk; start with whole-series and
  single-occurrence edits only.
- **Sync conflicts.** Outlook and Coxinha can both edit an event; `changeKey` detects it.
