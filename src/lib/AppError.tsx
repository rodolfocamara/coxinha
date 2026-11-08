import { useEffect, useState } from 'react';
import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { reportFrontendError } from './lifecycle';

/** Independent from AppShell so a shell failure cannot recurse. */
export function AppError({ reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [diagnostics, setDiagnostics] = useState('');
  useEffect(() => {
    reportFrontendError('root_render_error');
    void invoke<string>('desktop_diagnostic_info')
      .then(setDiagnostics)
      .catch(() => {});
  }, []);
  return (
    <main className="p-8 space-y-4">
      <h1>{t('desktopRecovery.title')}</h1>
      <p role="alert">{t('desktopRecovery.description')}</p>
      <pre className="whitespace-pre-wrap break-all text-sm">{diagnostics}</pre>
      <div className="flex gap-4">
        <button onClick={() => void router.invalidate().then(reset)}>
          {t('desktopRecovery.retry')}
        </button>
        <Link to="/notes">{t('nav.notes')}</Link>
        <Link to="/meetings">{t('nav.meetings')}</Link>
        <Link to="/settings">{t('nav.settings')}</Link>
      </div>
    </main>
  );
}
