import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, FileText, FlaskConical, Hash, Server, Sparkles } from 'lucide-react';
import { Alert, Button, Input } from '../../components/ui';
import { live, type TitleLlmSettings as Settings } from '../capture/live';
import { SettingsGroup, SettingsRow, Switch } from '../settings/controls';

/** Ajustes > Títulos e resumos: suggested titles from the user's own host over SSH (ADR 0024). */
export function TitleLlmSettings() {
  const { t } = useTranslation();
  const k = (key: string, values?: Record<string, unknown>) =>
    t(`people.settings.titles.${key}`, values);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [test, setTest] = useState<{ busy: boolean; title?: string; error?: string }>({
    busy: false,
  });
  useEffect(() => {
    let alive = true;
    live
      .titleSettings()
      .then((value) => {
        if (alive) {
          setSettings(value);
          setDraft(value);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!settings || !draft) return null;
  const save = (next: Settings) => {
    setError('');
    void live
      .saveTitleSettings(next)
      .then(setSettings)
      .catch((e) => setError(String(e)));
  };
  const field = (name: string, key: 'sshTarget' | 'model') => (
    <Input
      size="sm"
      className="w-full"
      spellCheck={false}
      aria-labelledby={`${name}-title`}
      value={draft[key]}
      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      onBlur={() => draft[key] !== settings[key] && save({ ...settings, [key]: draft[key].trim() })}
    />
  );
  const runTest = () => {
    setTest({ busy: true });
    live
      .testTitle(draft)
      .then((title) => setTest({ busy: false, title }))
      .catch((e) => setTest({ busy: false, error: String(e) }));
  };
  return (
    <>
      <SettingsGroup title={k('server')}>
        <SettingsRow
          name="titles-target"
          icon={Server}
          title={k('target')}
          control={field('titles-target', 'sshTarget')}
        />
        <SettingsRow
          name="titles-port"
          icon={Hash}
          title={k('port')}
          control={
            <Input
              size="sm"
              className="w-24"
              inputMode="numeric"
              aria-labelledby="titles-port-title"
              value={String(draft.remotePort)}
              onChange={(e) => setDraft({ ...draft, remotePort: Number(e.target.value) || 0 })}
              onBlur={() =>
                draft.remotePort !== settings.remotePort &&
                save({ ...settings, remotePort: draft.remotePort })
              }
            />
          }
        />
        <SettingsRow
          name="titles-model"
          icon={Cpu}
          title={k('model')}
          control={field('titles-model', 'model')}
        />
        <SettingsRow
          name="titles-test"
          icon={FlaskConical}
          title={k('testTitle')}
          description={k('privacy')}
          control={
            <Button
              size="sm"
              variant="secondary"
              disabled={test.busy || !draft.sshTarget.trim()}
              onClick={runTest}
            >
              {test.busy ? k('testing') : k('test')}
            </Button>
          }
          below={
            (error || test.title || test.error) && (
              <>
                {error && <Alert tone="error">{error}</Alert>}
                {test.title && <Alert tone="success">{k('testOk', { title: test.title })}</Alert>}
                {test.error && <Alert tone="error">{k('testFailed', { error: test.error })}</Alert>}
              </>
            )
          }
        />
      </SettingsGroup>
      <SettingsGroup title={k('whatItDoes')}>
        <SettingsRow
          name="titles"
          icon={Sparkles}
          titleId="titles-heading"
          title={k('title')}
          description={k('hint')}
          control={
            <Switch
              name="titles"
              labelledBy="titles-heading"
              checked={settings.enabled}
              disabled={!settings.sshTarget.trim()}
              onChange={(enabled) => save({ ...settings, enabled })}
            />
          }
        />
        <SettingsRow
          name="summaries"
          icon={FileText}
          titleId="summaries-heading"
          title={k('summaries')}
          description={k('summariesPrivacy')}
          control={
            <Switch
              name="summaries"
              labelledBy="summaries-heading"
              checked={settings.summaries}
              disabled={!settings.enabled}
              onChange={(summaries) => save({ ...settings, summaries })}
            />
          }
        />
      </SettingsGroup>
    </>
  );
}
