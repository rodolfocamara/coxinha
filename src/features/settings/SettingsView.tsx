import { useEffect, useState } from 'react';
import { RotateCw, Stethoscope } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { commands, type AppConfig, type ObsidianVault } from '../../lib/bindings';
import { Alert, Button } from '../../components/ui';
import { SettingsLayout } from './SettingsLayout';
import { SettingsSection } from './controls';
import { sectionHeadingId, type SettingsSectionId } from './settingsIndex';
import { AppearanceSection } from './AppearanceSection';
import { CalendarSection } from './CalendarSection';
import { RecordingSection } from './RecordingSection';
import { TranscriptionSection } from './TranscriptionSection';
import { IntegrationsSection, TitlesSection } from './IntegrationsSection';
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
  /** The page on screen; the route supplies it. */
  section?: SettingsSectionId;
  /** Hash of the row to land on. */
  target?: string;
  onNavigate?: (section: SettingsSectionId, target?: string) => void;
};

/** Pages that wait for the config; until then they show its state under their title. */
const CONFIG_PAGES: readonly SettingsSectionId[] = [
  'transcription',
  'integrations',
  'titles',
  'shortcuts',
  'storage',
  'diagnostics',
];

/**
 * Ajustes (spec 0096 P6). Aparência and Gravação work without the config;
 * the rest waits for `get_config` + `list_obsidian_vaults`.
 */
export function SettingsView({
  onOpenAgenda,
  section = 'appearance',
  target,
  onNavigate,
}: Props = {}) {
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

  const configState =
    state.kind === 'loading' ? (
      <p role="status" aria-live="polite" className="text-ui text-muted-foreground">
        {t('settings.loading')}
      </p>
    ) : state.kind === 'error' ? (
      <div className="space-y-3">
        <Alert tone="error">{t('settings.vault.loadError', { error: state.message })}</Alert>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => setRetry((v) => v + 1)}
            icon={<RotateCw size={14} aria-hidden="true" />}
          >
            {t('settings.recovery.retry')}
          </Button>
          <Button onClick={diagnostics.show} icon={<Stethoscope size={14} aria-hidden="true" />}>
            {t('settings.recovery.showDiagnostics')}
          </Button>
        </div>
        <DiagnosticsText text={diagnostics.text} />
      </div>
    ) : null;

  const configSections =
    state.kind === 'ready' ? (
      <>
        <TranscriptionSection config={state.config} />
        <IntegrationsSection onOpenAgenda={onOpenAgenda} />
        <TitlesSection />
        <ShortcutsSection shortcuts={state.config.shortcuts} />
        <StorageSection
          config={state.config}
          vaults={state.vaults}
          onConfig={(config) => setState({ ...state, config })}
        />
        <DiagnosticsSection />
      </>
    ) : (
      CONFIG_PAGES.map((id) => (
        <SettingsSection
          key={id}
          id={id}
          headingId={sectionHeadingId(id)}
          title={t(`people.settings.sections.${id}`)}
          description={t(`people.settings.descriptions.${id}`)}
        >
          {id === section && configState}
        </SettingsSection>
      ))
    );

  return (
    <SettingsLayout
      ready={state.kind === 'ready'}
      section={section}
      target={target}
      onNavigate={onNavigate}
    >
      <AppearanceSection
        onLocale={(locale) =>
          setState((now) =>
            now.kind === 'ready' ? { ...now, config: { ...now.config, locale } } : now
          )
        }
      />
      <CalendarSection />
      <RecordingSection />
      {configSections}
    </SettingsLayout>
  );
}
