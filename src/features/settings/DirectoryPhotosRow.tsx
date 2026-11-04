import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Contact } from 'lucide-react';
import { Alert, Button } from '../../components/ui';
import { useOutlookConnection } from '../agenda/useOutlookConnection';
import {
  directoryPhotos,
  onPhotosChanged,
  type DirectoryPhotoStatus,
} from '../people/personPhotos';
import { SettingsRow, Switch } from './controls';

/**
 * Spec 0117 P1: the opt-in for Microsoft 365 photos. Off by default; turning it
 * on is a new sign-in that asks for one more permission, and only a granted
 * permission turns it on. Turning it off deletes every photo.
 */
export function DirectoryPhotosRow() {
  const { t } = useTranslation();
  const s = (key: string, options?: Record<string, unknown>) =>
    t(`people.settings.directoryPhotos.${key}`, options);
  const [status, setStatus] = useState<DirectoryPhotoStatus | null>(null);
  const [failure, setFailure] = useState('');
  const reload = useCallback(() => {
    directoryPhotos
      .status()
      .then(setStatus)
      .catch(() => setFailure('statusError'));
  }, []);
  const outlook = useOutlookConnection({ onReset: reload });
  useEffect(() => {
    reload();
    return onPhotosChanged(reload);
  }, [reload]);

  const enabled = status?.enabled ?? false;
  const blocked = status?.blocked ?? null;
  const allow = () => {
    setFailure('');
    outlook.connectDirectoryPhotos();
  };
  const turnOff = () => {
    setFailure('');
    directoryPhotos
      .disable()
      .then(reload)
      .catch(() => setFailure('disableError'));
  };

  return (
    <SettingsRow
      name="directory-photos"
      icon={Contact}
      title={s('title')}
      description={s('hint')}
      control={
        <Switch
          name="directory-photos"
          checked={enabled}
          disabled={!status || outlook.busy || (!enabled && !outlook.connected)}
          onChange={(on) => (on ? allow() : turnOff())}
        />
      }
      below={
        <>
          <p className="text-xs text-muted-foreground">{s('privacy')}</p>
          {!outlook.connected && !enabled && (
            <p className="text-xs text-muted-foreground">{s('connectFirst')}</p>
          )}
          {enabled && (
            <p role="status" className="text-xs text-muted-foreground">
              {s('stored', { count: status?.stored ?? 0 })}
            </p>
          )}
          {outlook.connecting && (
            <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
              {s('waiting')}
              <Button size="xs" variant="ghost" onClick={outlook.cancel}>
                {s('cancel')}
              </Button>
            </p>
          )}
          {blocked && (
            <Alert tone="error">
              {t(blocked)}{' '}
              <Button size="xs" variant="ghost" disabled={outlook.busy} onClick={allow}>
                {s('reconnect')}
              </Button>
            </Alert>
          )}
          {!!outlook.error && <Alert tone="error">{outlook.error}</Alert>}
          {!!failure && <Alert tone="error">{s(failure)}</Alert>}
        </>
      }
    />
  );
}
