/**
 * Spec 0128: every keyboard shortcut once. Hints, the `?` sheet, Settings and
 * `pnpm test:shortcuts` read this table; the contract test fails on a key
 * handler that is not declared here.
 *
 * `Mod` is Ctrl, or Cmd on a Mac. `system` keys are the defaults of
 * `ShortcutsConfig` in Rust; the config can change them.
 */
export type ShortcutScope =
  | 'system'
  | 'app'
  | 'palette'
  | 'note'
  | 'board'
  | 'calendar'
  | 'layer'
  | 'list';

/**
 * Who handles the key: `listener` the one window listener (`useShortcut`),
 * `layer` the Escape stack, `element` a focused element's own `onKeyDown`,
 * `library` the editor, `system` the OS through the global-shortcut plugin.
 */
export type ShortcutOwner = 'listener' | 'layer' | 'element' | 'library' | 'system';

export type ShortcutEntry = {
  id: string;
  keys: readonly string[];
  scope: ShortcutScope;
  owner: ShortcutOwner;
  /** i18n key of what it does. */
  label: string;
  /** Chords that also fire with focus in a text field. */
  inFields?: boolean;
  /** Holding the key repeats the action. */
  repeat?: boolean;
  /** Modal scopes it still reaches. */
  overDialogs?: readonly string[];
  /** Files whose `onKeyDown` implements an `element` entry. */
  elements?: readonly string[];
  /** Plumbing, not something to learn: left out of the lists. */
  listed?: false;
};

const L = 'shortcuts.actions';

export const SHORTCUTS = [
  {
    id: 'system.new_note',
    keys: ['Ctrl+Alt+Y'],
    scope: 'system',
    owner: 'system',
    label: 'settings.shortcuts.action.new_note',
  },
  {
    id: 'system.open_app',
    keys: ['Ctrl+Alt+O'],
    scope: 'system',
    owner: 'system',
    label: 'settings.shortcuts.action.open_app',
  },
  {
    id: 'system.agenda',
    keys: ['Ctrl+Alt+G'],
    scope: 'system',
    owner: 'system',
    label: 'settings.shortcuts.action.agenda',
  },
  {
    id: 'system.meetings',
    keys: ['Ctrl+Alt+T'],
    scope: 'system',
    owner: 'system',
    label: 'settings.shortcuts.action.meetings',
  },
  {
    id: 'system.toggle_recording',
    keys: ['Ctrl+Alt+W'],
    scope: 'system',
    owner: 'system',
    label: 'people.settings.shortcuts.toggleRecording',
  },
  {
    id: 'app.palette',
    keys: ['Mod+K', 'Mod+P'],
    scope: 'app',
    owner: 'listener',
    label: `${L}.palette`,
    inFields: true,
    overDialogs: ['palette'],
  },
  { id: 'app.help', keys: ['?'], scope: 'app', owner: 'listener', label: `${L}.help` },
  { id: 'app.undoTrash', keys: ['Mod+Z'], scope: 'app', owner: 'listener', label: `${L}.undoTrash` },
  {
    id: 'palette.move',
    keys: ['ArrowUp', 'ArrowDown'],
    scope: 'palette',
    owner: 'element',
    label: `${L}.paletteMove`,
    elements: ['src/features/shell/CommandPalette.tsx'],
  },
  {
    id: 'palette.open',
    keys: ['Enter'],
    scope: 'palette',
    owner: 'element',
    label: `${L}.paletteOpen`,
    elements: ['src/features/shell/CommandPalette.tsx'],
  },
  {
    id: 'palette.delete',
    keys: ['Mod+Backspace'],
    scope: 'palette',
    owner: 'listener',
    label: `${L}.paletteDelete`,
    inFields: true,
  },
  {
    id: 'note.menu',
    keys: ['Mod+.'],
    scope: 'note',
    owner: 'listener',
    label: `${L}.noteMenu`,
    inFields: true,
  },
  {
    id: 'note.copyLink',
    keys: ['Mod+L'],
    scope: 'note',
    owner: 'listener',
    label: `${L}.noteCopyLink`,
    inFields: true,
  },
  {
    id: 'note.duplicate',
    keys: ['Mod+D'],
    scope: 'note',
    owner: 'listener',
    label: `${L}.noteDuplicate`,
    inFields: true,
  },
  { id: 'note.undo', keys: ['Mod+Z'], scope: 'note', owner: 'library', label: `${L}.noteUndo` },
  {
    id: 'board.remove',
    keys: ['Delete', 'Backspace'],
    scope: 'board',
    owner: 'listener',
    label: `${L}.boardRemove`,
    // React Flow also watches these for a selected dependency: BoardCanvas's `deleteKeyCode`.
    elements: ['src/features/board/BoardCanvas.tsx'],
  },
  { id: 'board.undo', keys: ['Mod+Z'], scope: 'board', owner: 'listener', label: `${L}.boardUndo` },
  { id: 'board.newNote', keys: ['1'], scope: 'board', owner: 'listener', label: `${L}.boardNote` },
  {
    id: 'board.newActivity',
    keys: ['2'],
    scope: 'board',
    owner: 'listener',
    label: `${L}.boardActivity`,
  },
  { id: 'board.newArea', keys: ['3'], scope: 'board', owner: 'listener', label: `${L}.boardArea` },
  {
    id: 'board.open',
    keys: ['Enter', 'Space'],
    scope: 'board',
    owner: 'element',
    label: `${L}.boardOpen`,
    elements: ['src/features/board/BoardCanvas.tsx', 'src/features/board/editor/CanvasNote.tsx'],
  },
  {
    id: 'calendar.today',
    keys: ['T'],
    scope: 'calendar',
    owner: 'listener',
    label: `${L}.calendarToday`,
  },
  {
    id: 'calendar.next',
    keys: ['J', 'ArrowRight'],
    scope: 'calendar',
    owner: 'listener',
    label: `${L}.calendarNext`,
    repeat: true,
  },
  {
    id: 'calendar.previous',
    keys: ['K', 'ArrowLeft'],
    scope: 'calendar',
    owner: 'listener',
    label: `${L}.calendarPrevious`,
    repeat: true,
  },
  { id: 'calendar.day', keys: ['D'], scope: 'calendar', owner: 'listener', label: `${L}.calendarDay` },
  {
    id: 'calendar.week',
    keys: ['W'],
    scope: 'calendar',
    owner: 'listener',
    label: `${L}.calendarWeek`,
  },
  {
    id: 'calendar.month',
    keys: ['M'],
    scope: 'calendar',
    owner: 'listener',
    label: `${L}.calendarMonth`,
  },
  { id: 'calendar.new', keys: ['N'], scope: 'calendar', owner: 'listener', label: `${L}.calendarNew` },
  {
    id: 'calendar.open',
    keys: ['Enter'],
    scope: 'calendar',
    owner: 'element',
    label: `${L}.calendarOpen`,
    elements: ['src/features/meetingsHub/CalendarBlock.tsx'],
  },
  {
    id: 'layer.close',
    keys: ['Escape'],
    scope: 'layer',
    owner: 'layer',
    label: `${L}.layerClose`,
  },
  {
    id: 'layer.cancelEdit',
    keys: ['Escape'],
    scope: 'layer',
    owner: 'element',
    label: `${L}.layerCancelEdit`,
    elements: [
      'src/features/board/BoardNodes.tsx',
      'src/features/board/editor/CanvasTextEditor.tsx',
      'src/features/meetings/TranscriptReader.tsx',
      'src/features/meetingsHub/MeetingHeading.tsx',
      'src/features/people/SampleRow.tsx',
      'src/features/settings/ChordCapture.tsx',
      'src/features/settings/SettingsFilter.tsx',
    ],
  },
  {
    id: 'list.move',
    keys: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'],
    scope: 'list',
    owner: 'element',
    label: `${L}.listMove`,
    elements: [
      'src/features/detection/RecordTarget.tsx',
      'src/features/meetings/PersonCombobox.tsx',
      'src/features/meetingsHub/TabBar.tsx',
      'src/features/meetingsHub/ViewSwitcher.tsx',
      'src/features/people/PeopleList.tsx',
      'src/features/settings/SettingsFilter.tsx',
      'src/features/workspace/KindSwitch.tsx',
    ],
  },
  {
    id: 'list.pick',
    keys: ['Enter'],
    scope: 'list',
    owner: 'element',
    label: `${L}.listPick`,
    elements: [
      'src/features/meetings/PersonCombobox.tsx',
      'src/features/meetings/TranscriptReader.tsx',
      'src/features/settings/SettingsFilter.tsx',
    ],
  },
  {
    id: 'dialog.focusTrap',
    keys: ['Tab'],
    scope: 'layer',
    owner: 'element',
    label: `${L}.dialogFocusTrap`,
    listed: false,
    elements: ['src/lib/DesktopRecoveryDialog.tsx'],
  },
] as const satisfies readonly ShortcutEntry[];

export type ShortcutId = (typeof SHORTCUTS)[number]['id'];
export type ListenerShortcutId = Extract<(typeof SHORTCUTS)[number], { owner: 'listener' }>['id'];

/** Most specific first: this order settles a key two mounted scopes both claim. */
export const SCOPE_ORDER: readonly ShortcutScope[] = [
  'palette',
  'note',
  'board',
  'calendar',
  'layer',
  'list',
  'app',
  'system',
];

const BY_ID = new Map<string, ShortcutEntry>(SHORTCUTS.map((entry) => [entry.id, entry]));

export const shortcutEntry = (id: ShortcutId): ShortcutEntry => BY_ID.get(id)!;
