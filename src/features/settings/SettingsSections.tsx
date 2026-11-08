import { useTranslation } from 'react-i18next';
import { Stethoscope } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';
import { Button } from '../../components/ui';
import { SettingsGroup, SettingsRow, SettingsSection } from './controls';

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
      <SettingsGroup>
        <SettingsRow
          name="diagnostics"
          icon={Stethoscope}
          title={t('people.settings.diagnostics.title')}
          control={
            <Button
              size="sm"
              onClick={diagnostics.show}
              icon={<Stethoscope size={14} aria-hidden="true" />}
            >
              {t('settings.recovery.showDiagnostics')}
            </Button>
          }
          below={diagnostics.text && <DiagnosticsText text={diagnostics.text} />}
        />
      </SettingsGroup>
    </SettingsSection>
  );
}
