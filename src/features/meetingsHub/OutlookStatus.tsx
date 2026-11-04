import { useTranslation } from 'react-i18next';
import { CalendarDays, RefreshCw, RotateCw, Settings2 } from 'lucide-react';
import { Button } from '../../components/ui';
import type { OutlookConnection } from '../agenda/useOutlookConnection';
import { clockTime } from './format';

/** Outlook sync state and account entry, at the foot of the calendar rail. */
export function OutlookStatus({
  connection,
  onOpen,
}: {
  connection: OutlookConnection;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const k = (key: string, options?: Record<string, unknown>) => t(`meetingsHub.${key}`, options);
  const synced = connection.snapshot.syncedAt ? new Date(connection.snapshot.syncedAt) : null;
  if (connection.error && !connection.busy)
    return (
      <footer className="ch-outlook" role="alert">
        <span className="min-w-0 flex-1 truncate text-warning" title={connection.error}>
          {connection.error}
        </span>
        <Button
          variant="ghost"
          size="xs"
          onClick={connection.retry}
          icon={<RotateCw size={14} aria-hidden="true" />}
        >
          {k('retry')}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          icon={<Settings2 size={13} aria-hidden="true" />}
          aria-label={k('outlookAccount')}
          title={k('outlookAccount')}
          onClick={onOpen}
        />
      </footer>
    );
  if (!connection.connected)
    return (
      <footer className="ch-outlook">
        <Button
          variant="ghost"
          size="sm"
          icon={<CalendarDays size={14} aria-hidden="true" />}
          onClick={onOpen}
        >
          {connection.needsReconnect ? k('outlookReconnect') : k('outlookConnect')}
        </Button>
      </footer>
    );
  return (
    <footer className="ch-outlook">
      <span className="mh-dot" data-tone="info" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {synced ? k('outlookSynced', { time: clockTime(synced, locale) }) : k('outlook')}
      </span>
      <Button
        variant="ghost"
        size="xs"
        iconOnly
        icon={<RefreshCw size={13} aria-hidden="true" />}
        aria-label={k('outlookSync')}
        title={k('outlookSync')}
        disabled={connection.busy}
        onClick={connection.sync}
      />
      <Button
        variant="ghost"
        size="xs"
        iconOnly
        icon={<Settings2 size={13} aria-hidden="true" />}
        aria-label={k('outlookAccount')}
        title={k('outlookAccount')}
        onClick={onOpen}
      />
    </footer>
  );
}
