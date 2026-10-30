import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  Input,
} from '../../components/ui';
import type { OutlookConnection } from './useOutlookConnection';

type Props = {
  connection: OutlookConnection;
  /** Shown when connected; Settings uses it to reach the agenda. */
  onOpenAgenda?: () => void;
  titleId?: string;
};

/** Outlook account status and explicit actions (structure after Todoist's calendar settings). */
export function OutlookConnectionCard({ connection, onOpenAgenda, titleId }: Props) {
  const { t } = useTranslation();
  const c = connection;
  const { snapshot, busy } = c;
  const hasCache = Boolean(snapshot.account || snapshot.syncedAt || snapshot.events.length);
  const status = c.connected ? 'connected' : c.needsReconnect ? 'reconnect' : 'disconnected';
  return (
    <Card aria-labelledby={titleId} aria-label={titleId ? undefined : t('outlook.connection')}>
      <CardHeader
        titleId={titleId}
        level={titleId ? 3 : 2}
        title={
          <span className="inline-flex items-center gap-2">
            <CalendarDays size={16} aria-hidden="true" />
            {t('outlook.title')}
          </span>
        }
        description={t('outlook.description')}
        actions={
          <Badge
            tone={
              status === 'connected' ? 'success' : status === 'reconnect' ? 'warning' : 'neutral'
            }
            dot
          >
            {status === 'connected'
              ? t('outlook.statusConnected')
              : status === 'reconnect'
                ? t('outlook.statusReconnect')
                : t('outlook.statusDisconnected')}
          </Badge>
        }
      />
      <CardBody className="space-y-4">
        {c.connected && snapshot.account && (
          <p className="truncate text-ui text-muted-foreground">
            {t('outlook.account', { account: snapshot.account })}
          </p>
        )}
        {snapshot.syncedAt && (
          <p className="text-xs text-muted-foreground">
            {t('outlook.freshness', { date: new Date(snapshot.syncedAt).toLocaleString() })}
          </p>
        )}
        {!c.connected && (
          <>
            <p className="text-ui text-muted-foreground">{t('outlook.setup')}</p>
            {/* Collapsed unless the build supplied no client ID, which blocks Connect. */}
            <details className="group space-y-4" open={!c.clientId.trim() || undefined}>
              <summary className="cursor-pointer text-ui text-muted-foreground hover:text-foreground">
                {t('outlook.advanced')}
              </summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label={t('outlook.clientId')} required>
                  <Input
                    value={c.clientId}
                    onChange={(e) => c.setClientId(e.target.value)}
                    disabled={busy}
                  />
                </Field>
                <Field label={t('outlook.tenant')}>
                  <Input
                    value={c.tenant}
                    onChange={(e) => c.setTenant(e.target.value)}
                    disabled={busy}
                  />
                </Field>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{t('outlook.permissions')}</p>
            </details>
            {!c.clientId.trim() && (
              <p className="text-xs text-muted-foreground">{t('outlook.clientIdMissing')}</p>
            )}
          </>
        )}
        {busy && (
          <p role="status" className="text-ui text-muted-foreground">
            {t('outlook.working')}
          </p>
        )}
        {c.error && (
          <Alert
            tone="error"
            action={
              <Button size="sm" onClick={c.retry}>
                {t('settings.recovery.retry')}
              </Button>
            }
          >
            {c.error}
          </Alert>
        )}
      </CardBody>
      <CardFooter>
        {c.connecting && (
          <Button variant="ghost" onClick={c.cancel}>
            {t('outlook.cancel')}
          </Button>
        )}
        {(c.connected || hasCache) && (
          <Button variant="danger" disabled={busy} onClick={c.disconnect}>
            {t('outlook.disconnect')}
          </Button>
        )}
        {c.connected ? (
          <>
            {onOpenAgenda && <Button onClick={onOpenAgenda}>{t('outlook.openAgenda')}</Button>}
            <Button variant="primary" disabled={busy} onClick={c.sync}>
              {t('outlook.sync')}
            </Button>
          </>
        ) : (
          <Button variant="primary" disabled={busy || !c.clientId.trim()} onClick={c.connect}>
            {t('outlook.connect')}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
