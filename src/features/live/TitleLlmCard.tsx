import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  Input,
} from '../../components/ui';
import { live, type TitleLlmSettings } from '../capture/live';
import { Switch } from '../settings/controls';

/** Ajustes > Integrações: suggested titles from the user's own host over SSH (ADR 0024). */
export function TitleLlmCard() {
  const { t } = useTranslation();
  const k = (key: string, values?: Record<string, unknown>) =>
    t(`people.settings.titles.${key}`, values);
  const [settings, setSettings] = useState<TitleLlmSettings | null>(null);
  const [draft, setDraft] = useState<TitleLlmSettings | null>(null);
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
  const save = (next: TitleLlmSettings) => {
    setError('');
    void live
      .saveTitleSettings(next)
      .then(setSettings)
      .catch((e) => setError(String(e)));
  };
  const field = (key: 'sshTarget' | 'model', label: string) => (
    <Field label={label}>
      <Input
        size="sm"
        spellCheck={false}
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        onBlur={() =>
          draft[key] !== settings[key] && save({ ...settings, [key]: draft[key].trim() })
        }
      />
    </Field>
  );
  const runTest = () => {
    setTest({ busy: true });
    live
      .testTitle(draft)
      .then((title) => setTest({ busy: false, title }))
      .catch((e) => setTest({ busy: false, error: String(e) }));
  };
  return (
    <Card aria-labelledby="titles-heading">
      <CardHeader
        titleId="titles-heading"
        level={3}
        title={
          <span className="inline-flex items-center gap-2">
            <Sparkles size={16} aria-hidden="true" />
            {k('title')}
          </span>
        }
        description={k('hint')}
        actions={
          <Switch
            name="titles"
            labelledBy="titles-heading"
            checked={settings.enabled}
            disabled={!settings.sshTarget.trim()}
            onChange={(enabled) => save({ ...settings, enabled })}
          />
        }
      />
      <CardBody className="grid grid-cols-[1fr_110px_1fr] gap-3">
        {field('sshTarget', k('target'))}
        <Field label={k('port')}>
          <Input
            size="sm"
            inputMode="numeric"
            value={String(draft.remotePort)}
            onChange={(e) => setDraft({ ...draft, remotePort: Number(e.target.value) || 0 })}
            onBlur={() =>
              draft.remotePort !== settings.remotePort &&
              save({ ...settings, remotePort: draft.remotePort })
            }
          />
        </Field>
        {field('model', k('model'))}
      </CardBody>
      <CardFooter>
        <p className="mr-auto text-xs text-muted-foreground">{k('privacy')}</p>
        <Button
          size="sm"
          variant="secondary"
          disabled={test.busy || !draft.sshTarget.trim()}
          onClick={runTest}
        >
          {test.busy ? k('testing') : k('test')}
        </Button>
      </CardFooter>
      {(error || test.title || test.error) && (
        <CardBody>
          {error && <Alert tone="error">{error}</Alert>}
          {test.title && <Alert tone="success">{k('testOk', { title: test.title })}</Alert>}
          {test.error && <Alert tone="error">{k('testFailed', { error: test.error })}</Alert>}
        </CardBody>
      )}
    </Card>
  );
}
