# Spec 0064: Collapsible workspace sidebar

- **Status:** in-progress
- **Phase:** F1

## Intent and references

Replace the mixed icon strip with a quiet labeled desktop navigation. The brand
starts at the top left, aligned with the content title bar. Keep the existing
comfort palette and native window controls.

References inspected for this design:
- [Loop](https://mobbin.com/screens/61a78a2b-79c1-4f38-ab12-132ad1637c7a): top-left brand and aligned content header.
- [Dropbox Dash](https://mobbin.com/screens/6b56d60a-fe8a-456c-a155-c007db13b612): labeled vertical navigation, search and recents.
- [Sana AI](https://mobbin.com/screens/890bfc70-836b-473f-b72a-0b2ddfd07626): simple functional groups with settings at the bottom.

## Contract

- Expanded sidebar uses the existing 256px width and full application height.
  Its 48px brand header aligns with ChromeCap in the adjacent content column.
- Collapse hides the entire sidebar. The content header exposes an expand button
  and small brand mark. Toggling moves focus to the replacement toggle.
- A dedicated sidebar store persists the preference independently of the right
  context panel. Invalid or unavailable storage defaults to expanded.
- Main navigation labels Home, Meeting library, Board, Agenda and Search. Search
  dispatches the existing command palette event. Settings stays below the
  independently scrollable navigation and real recents.
- Remove history arrows, horizontal quick icons, workspace options without an
  action, empty meeting-note section and duplicate new-meeting action. Explicit
  nonempty meeting-note fixtures and custom rail overrides remain supported.
- Native drag, window controls and existing close/save lifecycle are preserved.
- Accessible translated toggles identify their expanded state and, while mounted,
  their controlled sidebar. Long titles can shrink; desktop layout acceptance
  includes 800px width.

## Validation

Focused tests cover persistence/reload, malformed/unavailable storage, focus
handoff, navigation/search and removal of obsolete controls. TypeScript checks
and browser visual acceptance complement the unit coverage. Native desktop
acceptance remains a separate gate. Spec 0065 adds shared blank brand-header
dragging, decorative shortcut hints and page-title deduplication.
