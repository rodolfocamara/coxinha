import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';
import type { AppConfig } from '../../lib/bindings';
import { Button } from '../../components/ui';
import { SettingsCard, SettingsRow, SettingsSection } from './controls';

// Display order matches the user's mental model (create → navigate
// → record), not the struct field order.
const SHORTCUT_KEYS: ReadonlyArray<keyof AppConfig['shortcuts']> = [
  'new_note',
  'open_app',
  'agenda',
  'meetings',
  'toggle_recording',
];

/** Atalhos: the global shortcuts from the config, read-only until rebinding ships. */
export function ShortcutsSection({ shortcuts }: { shortcuts: AppConfig['shortcuts'] }) {
  const { t } = useTranslation();
  return (
    <SettingsSection
      id="shortcuts"
      headingId="shortcuts-heading"
      title={t('people.settings.sections.shortcuts')}
      description={t('people.settings.descriptions.shortcuts')}
    >
      <SettingsCard>
        {SHORTCUT_KEYS.map((key) => (
          <SettingsRow
            key={key}
            name={`shortcut-${key}`}
            title={
              key === 'toggle_recording'
                ? t('people.settings.shortcuts.toggleRecording')
                : t(`settings.shortcuts.action.${key}`)
            }
            control={<kbd className="cx-kbd">{shortcuts[key]}</kbd>}
          />
        ))}
      </SettingsCard>
      <p className="mt-2 text-xs text-muted-foreground">
        {t('settings.shortcuts.rebindComingSoon')}
      </p>
    </SettingsSection>
  );
}

/** Shared by the Diagnóstico section and the load-error state. */
export function useDiagnostics() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  return {
    text,
    show: () =>
      void invoke<string>('desktop_diagnostic_info')
        .then(setText)
        .catch(() => setText(t('settings.recovery.diagnosticError'))),
  };
}

export function DiagnosticsText({ text }: { text: string }) {
  return text ? (
    <pre
      className="max-h-80 overflow-auto rounded-lg bg-secondary p-3 text-xs break-all whitespace-pre-wrap"
      role="status"
    >
      {text}
    </pre>
  ) : null;
}

export function DiagnosticsSection() {
  const { t } = useTranslation();
  const diagnostics = useDiagnostics();
  return (
    <SettingsSection
      id="diagnostics"
      headingId="diagnostics-heading"
      title={t('people.settings.sections.diagnostics')}
      description={t('people.settings.descriptions.diagnostics')}
    >
      <SettingsCard>
        <SettingsRow
          name="diagnostics"
          title={t('people.settings.diagnostics.title')}
          control={
            <Button size="sm" onClick={diagnostics.show}>
              {t('settings.recovery.showDiagnostics')}
            </Button>
          }
          below={diagnostics.text && <DiagnosticsText text={diagnostics.text} />}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
