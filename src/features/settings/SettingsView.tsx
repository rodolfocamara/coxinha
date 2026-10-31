import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { commands, type AppConfig, type ObsidianVault } from '../../lib/bindings';
import { Alert, Button } from '../../components/ui';
import { SettingsLayout } from './SettingsLayout';
import { GeneralSection } from './GeneralSection';
import { RecordingSection } from './RecordingSection';
import { TranscriptionSection } from './TranscriptionSection';
import { IntegrationsSection } from './IntegrationsSection';
import { StorageSection } from './StorageSection';
import {
  DiagnosticsSection,
  DiagnosticsText,
  ShortcutsSection,
  useDiagnostics,
} from './SettingsSections';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; config: AppConfig; vaults: ObsidianVault[] }
  | { kind: 'error'; message: string };

type Props = {
  /** Opens the agenda from the Outlook integration; the route supplies navigation. */
  onOpenAgenda?: () => void;
  /** Section (`recording`) or legacy heading id (`integrations-heading`) to land on. */
  initialSection?: string;
};

/**
 * Ajustes (spec 0096 P6). Geral and Gravação work without the config;
 * the rest waits for `get_config` + `list_obsidian_vaults`.
 */
export function SettingsView({ onOpenAgenda, initialSection }: Props = {}) {
  const { t } = useTranslation();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const diagnostics = useDiagnostics();

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
      } catch {
        if (!cancelled) setState({ kind: 'error', message: t('settings.recovery.loadError') });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry]);

  const configSections =
    state.kind === 'loading' ? (
      <p role="status" aria-live="polite" className="text-ui text-muted-foreground">
        {t('settings.loading')}
      </p>
    ) : state.kind === 'error' ? (
      <div className="space-y-3">
        <Alert tone="error">{t('settings.vault.loadError', { error: state.message })}</Alert>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setRetry((v) => v + 1)}>
            {t('settings.recovery.retry')}
          </Button>
          <Button onClick={diagnostics.show}>{t('settings.recovery.showDiagnostics')}</Button>
        </div>
        <DiagnosticsText text={diagnostics.text} />
      </div>
    ) : (
      <>
        <TranscriptionSection config={state.config} />
        <IntegrationsSection onOpenAgenda={onOpenAgenda} />
        <ShortcutsSection shortcuts={state.config.shortcuts} />
        <StorageSection
          config={state.config}
          vaults={state.vaults}
          onConfig={(config) => setState({ ...state, config })}
        />
        <DiagnosticsSection />
      </>
    );

  return (
    <SettingsLayout ready={state.kind === 'ready'} initialSection={initialSection}>
      <GeneralSection />
      <RecordingSection />
      {configSections}
    </SettingsLayout>
  );
}
