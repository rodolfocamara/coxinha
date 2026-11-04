import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../lib/i18n';
import {
  matchSettings,
  resolveSettingsHash,
  SETTINGS_GROUPS,
  SETTINGS_ROWS,
  SETTINGS_SECTIONS,
  settingsIndexRedirect,
  settingsLocation,
  settingsPageRedirect,
} from './settingsIndex';

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, options as never) as unknown as string;
const found = (query: string) => matchSettings(t, query).map((entry) => entry.id);

describe('every old hash form', () => {
  it.each([
    ['appearance', 'appearance', undefined],
    ['calendar', 'calendar', undefined],
    ['recording', 'recording', undefined],
    ['transcription', 'transcription', undefined],
    ['integrations', 'integrations', undefined],
    ['shortcuts', 'shortcuts', undefined],
    ['storage', 'storage', undefined],
    ['diagnostics', 'diagnostics', undefined],
    ['#storage', 'storage', undefined],
    ['appearance-heading', 'appearance', undefined],
    ['calendar-heading', 'calendar', undefined],
    ['recording-heading', 'recording', undefined],
    ['transcription-heading', 'transcription', undefined],
    ['integrations-heading', 'integrations', undefined],
    ['shortcuts-heading', 'shortcuts', undefined],
    ['diagnostics-heading', 'diagnostics', undefined],
    ['vault-heading', 'storage', undefined],
    ['rebuild-heading', 'storage', 'rebuild-heading'],
    ['detection-heading', 'recording', 'detection-heading'],
    ['integrations-outlook-heading', 'integrations', 'integrations-outlook-heading'],
    ['titles-heading', 'titles', 'titles-heading'],
    ['summaries-heading', 'titles', 'summaries-heading'],
    ['theme-title', 'appearance', 'theme-title'],
    ['mic-title', 'recording', 'mic-title'],
    ['time-zones-title', 'calendar', 'time-zones-title'],
    ['live-model-title', 'transcription', 'live-model-title'],
    ['vault-title', 'storage', 'vault-title'],
  ])('%s lands on %s, row %s', (hash, section, target) => {
    expect(resolveSettingsHash(hash)).toEqual(target ? { section, target } : { section });
  });

  it('resolves every row by its id, title and description ids', () => {
    for (const row of SETTINGS_ROWS)
      for (const id of [row.id, row.anchor, `${row.id}-title`, `${row.id}-desc`]) {
        const resolved = resolveSettingsHash(id);
        expect(resolved?.section, id).toBe(
          // A row named like its page lands on the page.
          (SETTINGS_SECTIONS as readonly string[]).includes(id) ? id : row.section
        );
      }
  });

  it('opens the first page for an unknown hash, as the long page did', () => {
    expect(resolveSettingsHash('nope')).toBeNull();
    expect(settingsIndexRedirect('nope')).toEqual({
      to: '/settings/$section',
      params: { section: 'appearance' },
      hash: undefined,
      replace: true,
    });
  });
});

describe('redirects', () => {
  it('sends /settings to the first page without a history entry', () => {
    expect(settingsIndexRedirect('')).toMatchObject({
      params: { section: 'appearance' },
      replace: true,
    });
  });

  it('keeps a right URL and moves an unknown section or a hash on the wrong page', () => {
    expect(settingsPageRedirect('storage', '')).toBeNull();
    expect(settingsPageRedirect('storage', 'rebuild-heading')).toBeNull();
    expect(settingsPageRedirect('nonsense', '')).toMatchObject({
      params: { section: 'appearance' },
    });
    expect(settingsPageRedirect('appearance', 'rebuild-heading')).toMatchObject({
      params: { section: 'storage' },
      hash: 'rebuild-heading',
    });
  });

  it('builds a location from a row id', () => {
    expect(settingsLocation('rebuild')).toEqual({
      to: '/settings/$section',
      params: { section: 'storage' },
      hash: 'rebuild-heading',
    });
    expect(settingsLocation('integrations').hash).toBeUndefined();
  });
});

describe('the map', () => {
  it('has the groups in order, each page once', () => {
    expect(SETTINGS_GROUPS.map((group) => [group.id, [...group.sections]])).toEqual([
      ['app', ['appearance', 'shortcuts']],
      ['meetings', ['recording', 'transcription', 'calendar']],
      ['connections', ['integrations', 'titles']],
      ['system', ['storage', 'diagnostics']],
    ]);
    expect(new Set(SETTINGS_SECTIONS).size).toBe(SETTINGS_SECTIONS.length);
    expect(new Set(SETTINGS_ROWS.map((row) => row.id)).size).toBe(SETTINGS_ROWS.length);
  });
});

describe('match', () => {
  beforeAll(() => i18n.changeLanguage('pt-BR'));

  it('finds the settings the owner asked for', () => {
    expect(found('fonte')).toEqual(expect.arrayContaining(['fontSize', 'fontSans', 'fontMono']));
    expect(found('fuso')).toEqual(expect.arrayContaining(['time-zones', 'local-zone']));
    expect(found('microfone')[0]).toBe('mic');
  });

  it('ignores case and accents, and puts title matches first', () => {
    expect(found('AUDIO')).toEqual(found('áudio'));
    expect(found('áudio')[0]).toBe('output');
    expect(found('resumo')[0]).toBe('summaries');
  });

  it('takes the words in any order and finds nothing on an empty query', () => {
    expect(found('interface fonte')).toContain('fontSans');
    expect(found('   ')).toEqual([]);
    expect(found('zzz')).toEqual([]);
  });

  it('also finds through synonyms, in English too', async () => {
    expect(found('zoom')).toContain('fontSize');
    await i18n.changeLanguage('en');
    expect(found('zoom')).toContain('fontSize');
    expect(found('time zone')).toEqual(expect.arrayContaining(['time-zones']));
    await i18n.changeLanguage('pt-BR');
  });
});
