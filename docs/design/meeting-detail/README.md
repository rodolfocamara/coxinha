# Meeting detail: references and evidence

Design notes for [spec 0126](../../specs/0126-meeting-detail.md). The repo's design
tokens decide colour and type; the references below only informed the structure.

`contact-sheet.png` shows every required state before and after, in both themes.
Reproduce it with `tools/ui-preview/meeting-detail.mjs` and
`tools/ui-preview/contact-sheet.mjs`; the data is fictional
(`tools/ui-preview/fixtures/zz-meeting-detail.js`).

## What was taken from where

| Reference | Taken |
| --- | --- |
| Outlook's event form (owner's screenshot) | Join always findable at the top. Participants grouped by response with counts, avatars, and required or optional. Short facts about the recording. Not its form-like density |
| [Calendly, event side panel](https://mobbin.com/screens/3b379998-72b4-4313-b418-ee0cb610baac) ([second view](https://mobbin.com/screens/2cb71f1d-cd9c-4675-8fd4-1b9dc19ddad5)) | Title and time first, then the action, then plain sentence-case sections in a narrow column |
| [Maze, session details](https://mobbin.com/screens/4f1274cb-edca-45c1-8aad-fae84faae015) | Time and join kept together as one block above everything else |
| [Lightfield, meeting page](https://mobbin.com/screens/8dce3755-0822-45f8-835d-a2561536bd75) | A quiet check at the end of a participant row, for what is confirmed |
| [Time2book, booking details](https://mobbin.com/screens/3c2ac842-7d3d-46c7-b950-58c5466fad45) | Counts by attendance as the summary of the people section |
| [Grain, meeting summary](https://mobbin.com/screens/6fafb81f-4df9-4f99-aeab-19452c587e9b) and [Calendly, recap](https://mobbin.com/screens/6fc83e69-b982-4945-bc3d-462e50aebfb7) | After a meeting: summary first, then what follows from it, people after that |
| [Campsite, call page](https://mobbin.com/screens/e25dbcd8-8ca3-4c60-ae41-6eea865081a6) | The useful or not useful mark comes after the content it judges |

Mobbin has no screens indexed for Notion Calendar, Google Calendar or Granola under
those names; searching for them returned other products. Cron, Fantastical and
Linear did not appear in the searches either, so nothing here comes from them.

## What the checks found and fixed

- Before, at 1280×800: join was cut at the bottom edge after the invitee list, the
  outcome was below the fold, and long file names ran 132px past the panel.
- A button keeps `white-space: nowrap` by default, so in the panel and the inspector
  labels now wrap. At a larger type scale "Import audio for this meeting" ran over.
- The link picker in the inspector grew past its column with a long note title: its
  grids had no `minmax(0, 1fr)` column.
- The note of a prepared meeting never showed in the peek: the query waited on a
  summary query that is disabled until there is a recording.
