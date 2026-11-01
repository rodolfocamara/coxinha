import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { homeDir, join } from '@tauri-apps/api/path';
import { Alert, Button, Input, Select } from '../../components/ui';
import { live, HANDY_TAGARELA, type LiveSettings as Settings } from '../capture/live';
import { SettingsCard, SettingsRow, Switch } from '../settings/controls';

const THREADS = [2, 4, 6, 8];

/** Ajustes > Transcrição local rows for spec 0097 P3 (off by default). */
export function LiveSettings() {
  const { t } = useTranslation();
  const k = (key: string) => t(`people.settings.live.${key}`);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    live
      .settings()
      .then((value) => {
        if (!alive) return;
        setSettings(value);
        setPath(value.modelPath);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!settings) return null;
  const save = (next: Partial<Settings>) => {
    const merged = { ...settings, ...next };
    setSettings(merged);
    setError('');
    void live.saveSettings(merged).catch((e) => setError(String(e)));
  };
  const useHandy = async () => {
    const value = await join(await homeDir(), HANDY_TAGARELA);
    setPath(value);
    save({ modelPath: value });
  };
  return (
    <SettingsCard>
      <SettingsRow
        name="live"
        title={k('title')}
        description={k('hint')}
        control={
          <Switch
            name="live"
            checked={settings.enabled}
            disabled={!settings.modelPath.trim()}
            onChange={(enabled) => save({ enabled })}
          />
        }
        below={!settings.modelPath.trim() && <Alert tone="info">{k('needsModel')}</Alert>}
      />
      <SettingsRow
        name="live-model"
        title={k('model')}
        description={k('modelHint')}
        control={
          <Button size="sm" variant="secondary" onClick={() => void useHandy()}>
            {k('useHandy')}
          </Button>
        }
        below={
          <>
            <Input
              size="sm"
              aria-labelledby="live-model-title"
              value={path}
              placeholder={`~/${HANDY_TAGARELA}`}
              spellCheck={false}
              onChange={(e) => setPath(e.target.value)}
              onBlur={() => path !== settings.modelPath && save({ modelPath: path.trim() })}
            />
            {error && <Alert tone="error">{error}</Alert>}
          </>
        }
      />
      <SettingsRow
        name="live-threads"
        title={k('threads')}
        description={k('threadsHint')}
        control={
          <Select
            size="sm"
            block
            aria-labelledby="live-threads-title"
            value={String(settings.nThreads)}
            onChange={(e) => save({ nThreads: Number(e.target.value) })}
          >
            {THREADS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        }
      />
    </SettingsCard>
  );
}
