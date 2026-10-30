import { DetectionSettings } from '../detection/DetectionSettings';
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  commands,
  type AppConfig,
  type ObsidianVault,
  type RebuildStats,
} from '../../lib/bindings';
import { useAppStore } from '../../lib/store';
import { SettingsRebuildError } from './SettingsRebuildError';
import { AppearanceSection, ShortcutsSection } from './SettingsSections';
import { SettingsFrame } from './SettingsFrame';
import { IntegrationsSection } from './IntegrationsSection';
import { Alert, Badge, Button, Input } from '../../components/ui';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; config: AppConfig; vaults: ObsidianVault[] }
  | { kind: 'error'; message: string };

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

type Props = {
  /** Opens the agenda from the Outlook integration; the route supplies navigation. */
  onOpenAgenda?: () => void;
  /** Heading id to focus once preferences load, e.g. `integrations-heading`. */
  initialSection?: string;
};

export function SettingsView({ onOpenAgenda, initialSection }: Props = {}) {
  const { t, i18n } = useTranslation();
  const loadNotes = useAppStore((s) => s.loadNotes);
  const [retry, setRetry] = useState(0);
  const [diagnostics, setDiagnostics] = useState('');
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [rebuild, setRebuild] = useState<RebuildState>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ kind: 'loading' });
      try {
        const [cfgRes, vaultRes] = await Promise.all([
          commands.getConfig(),
          commands.listObsidianVaults(),
        ]);
        if (cancelled) return;

        if (cfgRes.status === 'error') {
          setState({ kind: 'error', message: cfgRes.error });
          return;
        }
        const vaults = vaultRes.status === 'ok' ? vaultRes.data : [];
        setState({ kind: 'ready', config: cfgRes.data, vaults });
        setSelectedPath(cfgRes.data.vault_path);
      } catch {
        if (!cancelled) setState({ kind: 'error', message: t('settings.recovery.loadError') });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retry]);

  useEffect(() => {
    if (state.kind !== 'ready' || !initialSection) return;
    const heading = document.getElementById(initialSection);
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView?.({ block: 'start' });
  }, [state.kind, initialSection]);

  const dirty = useMemo(() => {
    if (state.kind !== 'ready') return false;
    return selectedPath.trim().length > 0 && selectedPath !== state.config.vault_path;
  }, [state, selectedPath]);

  async function onSave() {
    if (state.kind !== 'ready' || !dirty) return;
    setSave({ kind: 'saving' });
    const next: AppConfig = { ...state.config, vault_path: selectedPath.trim() };
    const res = await commands.updateConfig(next);
    if (res.status === 'error') {
      setSave({ kind: 'error', message: res.error });
      return;
    }
    setSave({ kind: 'saved' });
    setState({ ...state, config: next });
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

  if (state.kind === 'loading') {
    return (
      <SettingsFrame>
        <p role="status" aria-live="polite" className="text-ui text-muted-foreground">
          {t('settings.loading')}
        </p>
      </SettingsFrame>
    );
  }
  if (state.kind === 'error') {
    return (
      <SettingsFrame>
        <Alert tone="error">{t('settings.vault.loadError', { error: state.message })}</Alert>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setRetry((v) => v + 1)}>
            {t('settings.recovery.retry')}
          </Button>
          <Button
            onClick={() =>
              void invoke<string>('desktop_diagnostic_info')
                .then(setDiagnostics)
                .catch(() => setDiagnostics(t('settings.recovery.diagnosticError')))
            }
          >
            {t('settings.recovery.showDiagnostics')}
          </Button>
        </div>
        {diagnostics && (
          <pre className="whitespace-pre-wrap break-all text-xs" role="status">
            {diagnostics}
          </pre>
        )}
      </SettingsFrame>
    );
  }

  const { vaults, config } = state;

  return (
    <SettingsFrame>
      <AppearanceSection />
      <DetectionSettings />
      <IntegrationsSection onOpenAgenda={onOpenAgenda} />
      <section aria-labelledby="vault-heading" className="space-y-4">
        <h2 id="vault-heading">{t('settings.vault.heading')}</h2>

        <p className="text-sm text-muted-foreground">
          <span className="font-medium">{t('settings.vault.currentPath')}:</span>{' '}
          <code className="font-mono">{config.vault_path}</code>
        </p>

        <p className="text-sm text-muted-foreground">{t('settings.recovery.vaultSwitch')}</p>
        <details className="settings-advanced">
          <summary>{t('settings.vault.otherFolders')}</summary>
          <fieldset disabled className="space-y-2">
            <legend className="text-sm font-medium">{t('settings.vault.detectedObsidian')}</legend>
            {vaults.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('settings.vault.noObsidian')}</p>
            ) : (
              <ul className="space-y-1">
                {vaults.map((v) => (
                  <li key={v.id}>
                    <label className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-accent/50 cursor-pointer">
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
            <Button variant="primary" onClick={onSave} disabled={true}>
              {save.kind === 'saving' ? t('settings.vault.saving') : t('settings.vault.save')}
            </Button>
            {save.kind === 'saved' && <Alert tone="success">{t('settings.vault.saved')}</Alert>}
            {save.kind === 'error' && (
              <Alert tone="error">{t('settings.vault.saveError', { error: save.message })}</Alert>
            )}
          </div>
        </details>
      </section>

      <ShortcutsSection shortcuts={config.shortcuts} />

      <section aria-labelledby="rebuild-heading" className="space-y-3">
        <h2 id="rebuild-heading">{t('settings.vault.rebuildHeading')}</h2>
        <p className="text-sm text-muted-foreground">{t('settings.vault.rebuildDescription')}</p>
        <div className="flex flex-col items-start gap-3">
          <Button onClick={onRebuild} disabled={rebuild.kind === 'running'}>
            {rebuild.kind === 'running'
              ? t('settings.vault.rebuilding')
              : t('settings.vault.rebuild')}
          </Button>
          {rebuild.kind === 'done' && (
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
          )}
          {rebuild.kind === 'error' && <SettingsRebuildError message={rebuild.message} />}
        </div>
      </section>
      <section aria-labelledby="diagnostics-heading" className="space-y-2">
        <h2 id="diagnostics-heading">{t('settings.recovery.diagnostics')}</h2>
        <Button
          onClick={() =>
            void invoke<string>('desktop_diagnostic_info')
              .then(setDiagnostics)
              .catch(() => setDiagnostics(t('settings.recovery.diagnosticError')))
          }
        >
          {t('settings.recovery.showDiagnostics')}
        </Button>
        {diagnostics && (
          <pre className="whitespace-pre-wrap break-all text-xs" role="status">
            {diagnostics}
          </pre>
        )}
      </section>
    </SettingsFrame>
  );
}

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
