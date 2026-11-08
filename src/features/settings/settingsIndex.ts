/** Spec 0129: the settings map. The sidebar, the filter, Ctrl+K and old links all read this table. */
export const SETTINGS_GROUPS = [
  { id: 'app', sections: ['appearance', 'shortcuts'] },
  { id: 'meetings', sections: ['recording', 'transcription', 'calendar'] },
  { id: 'connections', sections: ['integrations', 'titles'] },
  { id: 'system', sections: ['storage', 'diagnostics'] },
] as const;

export type SettingsSectionId = (typeof SETTINGS_GROUPS)[number]['sections'][number];

export const SETTINGS_SECTIONS: readonly SettingsSectionId[] = SETTINGS_GROUPS.flatMap(
  (group) => group.sections
);
export const FIRST_SETTINGS_SECTION = SETTINGS_SECTIONS[0];

export type SettingsRowEntry = {
  id: string;
  section: SettingsSectionId;
  /** The element that takes focus: the row's title. */
  anchor: string;
  title: string;
  hint?: string;
};

const P = 'people.settings';
const row = (
  section: SettingsSectionId,
  id: string,
  title: string,
  hint?: string,
  anchor = `${id}-title`
): SettingsRowEntry => ({ id, section, anchor, title, hint });

export const SETTINGS_ROWS: readonly SettingsRowEntry[] = [
  row('appearance', 'theme', `${P}.theme.title`, `${P}.theme.hint`),
  row('appearance', 'accent', `${P}.accent.title`, `${P}.accent.hint`),
  row('appearance', 'ambient', `${P}.ambient.title`, `${P}.ambient.hint`),
  row('appearance', 'fontSize', `${P}.fontSize.title`, `${P}.fontSize.hint`),
  row('appearance', 'contrast', `${P}.contrast.title`, `${P}.contrast.hint`),
  row('appearance', 'fontSans', `${P}.fontSans.title`, `${P}.fontSans.hint`),
  row('appearance', 'fontMono', `${P}.fontMono.title`, `${P}.fontMono.hint`),
  row('appearance', 'language', `${P}.language.title`, `${P}.language.hint`),
  row('shortcuts', 'shortcut-new_note', 'settings.shortcuts.action.new_note'),
  row('shortcuts', 'shortcut-open_app', 'settings.shortcuts.action.open_app'),
  row('shortcuts', 'shortcut-agenda', 'settings.shortcuts.action.agenda'),
  row('shortcuts', 'shortcut-meetings', 'settings.shortcuts.action.meetings'),
  row('shortcuts', 'shortcut-toggle_recording', `${P}.shortcuts.toggleRecording`),
  row('shortcuts', 'shortcuts-all', 'shortcuts.settings.all', undefined, 'shortcuts-all-heading'),
  row('recording', 'mic', `${P}.mic.title`, `${P}.mic.hint`),
  row('recording', 'output', `${P}.output.title`, `${P}.output.hint`),
  row('recording', 'detection', `${P}.detection.title`, `${P}.detection.hint`, 'detection-heading'),
  row('recording', 'auto-record', `${P}.autoRecord.title`, `${P}.autoRecord.hint`),
  row('recording', 'auto-stop', `${P}.autoRecord.stopTitle`, `${P}.autoRecord.stopHint`),
  row('transcription', 'live', `${P}.live.title`, `${P}.live.hint`),
  row('transcription', 'live-backlog', `${P}.live.backlog`, `${P}.live.backlogHint`),
  row('transcription', 'live-model', `${P}.live.model`, `${P}.live.modelHint`),
  row('transcription', 'live-threads', `${P}.live.threads`, `${P}.live.threadsHint`),
  row('transcription', 'transcriber', `${P}.transcription.engine`),
  row('transcription', 'diarizer', `${P}.transcription.diarizer`),
  row('calendar', 'local-zone', `${P}.zones.localTitle`, `${P}.zones.localHint`),
  row('calendar', 'time-zones', `${P}.zones.title`, `${P}.zones.hint`),
  row('calendar', 'directory-photos', `${P}.directoryPhotos.title`, `${P}.directoryPhotos.hint`),
  row('integrations', 'outlook', 'outlook.title', undefined, 'integrations-outlook-heading'),
  row('titles', 'titles-target', `${P}.titles.target`),
  row('titles', 'titles-port', `${P}.titles.port`),
  row('titles', 'titles-model', `${P}.titles.model`),
  row('titles', 'titles-test', `${P}.titles.testTitle`, `${P}.titles.privacy`),
  row('titles', 'suggest-titles', `${P}.titles.title`, `${P}.titles.hint`, 'titles-heading'),
  row(
    'titles',
    'summaries',
    `${P}.titles.summaries`,
    `${P}.titles.summariesPrivacy`,
    'summaries-heading'
  ),
  row('storage', 'vault', `${P}.storage.folder`),
  row(
    'storage',
    'rebuild',
    'settings.vault.rebuildHeading',
    'settings.vault.rebuildDescription',
    'rebuild-heading'
  ),
  row('diagnostics', 'diagnostics', `${P}.diagnostics.title`),
];

/** Kept equal to the pre-0096 heading ids, so old links still name a real element. */
export const sectionHeadingId = (section: SettingsSectionId) =>
  section === 'storage'
    ? 'vault-heading'
    : section === 'titles'
      ? 'titles-page-heading'
      : `${section}-heading`;

const isSection = (id: string): id is SettingsSectionId =>
  (SETTINGS_SECTIONS as readonly string[]).includes(id);

/** Every hash that used to resolve in the long page, and the new row anchors. */
export function resolveSettingsHash(
  hash: string
): { section: SettingsSectionId; target?: string } | null {
  const id = hash.replace(/^#/, '');
  if (!id) return null;
  if (isSection(id)) return { section: id };
  const entry = SETTINGS_ROWS.find(
    (r) => r.id === id || r.anchor === id || `${r.id}-title` === id || `${r.id}-desc` === id
  );
  if (entry) return { section: entry.section, target: entry.anchor };
  const page = SETTINGS_SECTIONS.find((section) => sectionHeadingId(section) === id);
  return page ? { section: page } : null;
}

/** Where a section, a row or an old hash lives, as a router location. */
export function settingsLocation(id: string) {
  const found = resolveSettingsHash(id);
  return {
    to: '/settings/$section' as const,
    params: { section: found?.section ?? FIRST_SETTINGS_SECTION },
    hash: found?.target,
  };
}

/** `/settings` and `/settings#<old form>`: never leaves itself behind in the history. */
export function settingsIndexRedirect(hash: string) {
  return { ...settingsLocation(hash), replace: true };
}

/** An unknown section, or a hash that lives on another page; null when the URL is right. */
export function settingsPageRedirect(section: string, hash: string) {
  if (!isSection(section)) return settingsIndexRedirect(hash);
  const found = resolveSettingsHash(hash);
  if (found && found.section !== section) return settingsIndexRedirect(hash);
  return null;
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Settings matching the words typed, in any order; matches on the title come first. */
export function matchSettings(t: Translate, query: string): SettingsRowEntry[] {
  const typed = fold(query.trim());
  if (!typed) return [];
  const words = typed.split(/\s+/);
  const ranked: { entry: SettingsRowEntry; rank: number }[] = [];
  for (const entry of SETTINGS_ROWS) {
    const title = fold(t(entry.title));
    const keywords = fold(t(`${P}.keywords.${entry.id}`, { defaultValue: '' }));
    const rest = [entry.hint ? t(entry.hint) : '', t(`${P}.sections.${entry.section}`)]
      .map(fold)
      .join(' ');
    const has = (text: string) => words.every((word) => text.includes(word));
    if (title.includes(typed)) ranked.push({ entry, rank: 0 });
    else if (has(`${title} ${keywords}`)) ranked.push({ entry, rank: 1 });
    else if (has(`${title} ${keywords} ${rest}`)) ranked.push({ entry, rank: 2 });
  }
  return ranked.sort((a, b) => a.rank - b.rank).map((item) => item.entry);
}
