import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  commands,
  type AppConfig,
  type ObsidianVault,
  type RebuildStats,
} from '../../lib/bindings';
import { useAppStore } from '../../lib/store';
import { Alert, Badge, Button, Input } from '../../components/ui';
import { SettingsRebuildError } from './SettingsRebuildError';
import { SettingsCard, SettingsRow, SettingsSection } from './controls';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

type RebuildState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; stats: RebuildStats }
  | { kind: 'error'; message: string };

function formatRelative(ms: number, locale?: string): string {
  const seconds = (ms - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ] as const) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'minute');
}

/**
 * Armazenamento: the vault folder (switching stays disabled until storage
 * supports migration) and the index rebuild from the Markdown files.
 */
export function StorageSection({
  config,
  vaults,
  onConfig,
}: {
  config: AppConfig;
  vaults: ObsidianVault[];
  onConfig: (config: AppConfig) => void;
}) {
  const { t, i18n } = useTranslation();
  const loadNotes = useAppStore((s) => s.loadNotes);
  const [selectedPath, setSelectedPath] = useState(config.vault_path);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [rebuild, setRebuild] = useState<RebuildState>({ kind: 'idle' });
  const dirty = useMemo(
    () => selectedPath.trim().length > 0 && selectedPath !== config.vault_path,
    [selectedPath, config.vault_path]
  );

  async function onSave() {
    if (!dirty) return;
    setSave({ kind: 'saving' });
    const next: AppConfig = { ...config, vault_path: selectedPath.trim() };
    const res = await commands.updateConfig(next);
    if (res.status === 'error') {
      setSave({ kind: 'error', message: res.error });
      return;
    }
    setSave({ kind: 'saved' });
    onConfig(next);
  }

  async function onRebuild() {
    setRebuild({ kind: 'running' });
    try {
      const res = await commands.rebuildFromVault();
      if (res.status === 'error') {
        setRebuild({ kind: 'error', message: res.error });
        return;
      }
      setRebuild({ kind: 'done', stats: res.data });
      await loadNotes();
    } catch {
      setRebuild({ kind: 'error', message: t('settings.recovery.loadError') });
    }
  }

  const otherFolders = (
    <details className="settings-advanced text-ui">
      <summary className="cursor-pointer text-muted-foreground">
        {t('settings.vault.otherFolders')}
      </summary>
      <div className="mt-3 space-y-3">
        <fieldset disabled className="space-y-2">
          <legend className="text-sm font-medium">{t('settings.vault.detectedObsidian')}</legend>
          {vaults.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('settings.vault.noObsidian')}</p>
          ) : (
            <ul className="space-y-1">
              {vaults.map((v) => (
                <li key={v.id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5">
                    <input
                      type="radio"
                      name="vault"
                      value={v.path}
                      checked={selectedPath === v.path}
                      onChange={() => setSelectedPath(v.path)}
                      className="mt-1"
                      aria-describedby={`vault-meta-${v.id}`}
                    />
                    <span className="flex-1">
                      <span className="font-medium">{v.name || v.path}</span>
                      <span
                        id={`vault-meta-${v.id}`}
                        className="block text-xs text-muted-foreground"
                      >
                        <code className="font-mono">{v.path}</code>
                        {' · '}
                        {v.last_opened_ms
                          ? `${t('settings.vault.lastOpenedPrefix')} ${formatRelative(v.last_opened_ms, i18n?.resolvedLanguage)}`
                          : t('settings.vault.neverOpened')}
                        {!v.exists && (
                          <>
                            {' · '}
                            <Badge tone="warning">{t('settings.vault.missingFolder')}</Badge>
                          </>
                        )}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        <fieldset disabled className="space-y-1">
          <label htmlFor="vault-custom-path" className="cx-field-label">
            {t('settings.vault.customPath')}
          </label>
          <Input
            id="vault-custom-path"
            type="text"
            value={selectedPath}
            onChange={(e) => setSelectedPath(e.target.value)}
            placeholder={t('settings.vault.customPathPlaceholder')}
            className="font-mono"
          />
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          {/* Switching folders is disabled until storage supports migration. */}
          <Button variant="primary" size="sm" onClick={onSave} disabled={true}>
            {save.kind === 'saving' ? t('settings.vault.saving') : t('settings.vault.save')}
          </Button>
          {save.kind === 'saved' && <Alert tone="success">{t('settings.vault.saved')}</Alert>}
          {save.kind === 'error' && (
            <Alert tone="error">{t('settings.vault.saveError', { error: save.message })}</Alert>
          )}
        </div>
      </div>
    </details>
  );

  return (
    <SettingsSection
      id="storage"
      headingId="vault-heading"
      title={t('people.settings.sections.storage')}
      description={t('people.settings.descriptions.storage')}
    >
      <SettingsCard>
        <SettingsRow
          name="vault"
          title={t('people.settings.storage.folder')}
          description={<code className="font-mono">{config.vault_path}</code>}
          below={
            <>
              <p className="text-xs text-muted-foreground">{t('settings.recovery.vaultSwitch')}</p>
              {otherFolders}
            </>
          }
        />
        <SettingsRow
          name="rebuild"
          titleId="rebuild-heading"
          heading
          title={t('settings.vault.rebuildHeading')}
          description={t('settings.vault.rebuildDescription')}
          control={
            <Button size="sm" onClick={onRebuild} disabled={rebuild.kind === 'running'}>
              {rebuild.kind === 'running'
                ? t('settings.vault.rebuilding')
                : t('settings.vault.rebuild')}
            </Button>
          }
          below={
            rebuild.kind === 'done' ? (
              <Alert tone={rebuild.stats.notes_skipped > 0 ? 'warning' : 'success'}>
                {rebuild.stats.notes_skipped > 0
                  ? t('settings.vault.rebuiltWithSkips', {
                      notes: String(rebuild.stats.notes_indexed),
                      links: String(rebuild.stats.links_indexed),
                      skipped: String(rebuild.stats.notes_skipped),
                    })
                  : t('settings.vault.rebuiltSuccess', {
                      notes: String(rebuild.stats.notes_indexed),
                      links: String(rebuild.stats.links_indexed),
                    })}
              </Alert>
            ) : rebuild.kind === 'error' ? (
              <SettingsRebuildError message={rebuild.message} />
            ) : null
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}
