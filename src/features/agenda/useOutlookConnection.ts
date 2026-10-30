import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-shell';
import { calendar, emptyCalendar, type CalendarSnapshot } from './calendar';

type Options = {
  /** Called after a connection or disconnection replaces the cached snapshot. */
  onReset?: () => void;
};

/**
 * Explicit Outlook connection state shared by Settings and Agenda. Opening a
 * view reads only the local cache; authorization starts from `connect` and an
 * unfinished attempt is cancelled when the view unmounts.
 */
export function useOutlookConnection({ onReset }: Options = {}) {
  const { t } = useTranslation();
  const mounted = useRef(true);
  const attempt = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (attempt.current) void calendar.cancel(attempt.current).catch(() => undefined);
    };
  }, []);
  const [snapshot, setSnapshot] = useState<CalendarSnapshot>(emptyCalendar);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  // Build-time defaults let a local build target its own Entra app without committing tenant IDs.
  const [clientId, setClientId] = useState(
    () => localStorage.getItem('outlook.clientId') || import.meta.env.VITE_OUTLOOK_CLIENT_ID || ''
  );
  const [tenant, setTenant] = useState(
    () =>
      localStorage.getItem('outlook.tenant') ||
      import.meta.env.VITE_OUTLOOK_TENANT ||
      'organizations'
  );
  useEffect(() => {
    let active = true;
    calendar
      .status()
      .then((s) => {
        if (active) setSnapshot(s);
      })
      .catch(() => {
        if (active) setError(t('outlook.loadError'));
      });
    return () => {
      active = false;
    };
  }, [retry]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      if (mounted.current) {
        const code = e instanceof Error ? e.message : String(e);
        if (code === 'calendar.reconnect' || code === 'calendar.accountChanged')
          setNeedsReconnect(true);
        setError(t(code.startsWith('calendar.') ? code : 'calendar.failed'));
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
        setConnecting(false);
      }
    }
  }

  function connect() {
    void run(async () => {
      localStorage.setItem('outlook.clientId', clientId.trim());
      localStorage.setItem('outlook.tenant', tenant.trim());
      const auth = await calendar.begin(clientId.trim(), tenant.trim());
      if (!mounted.current) {
        await calendar.cancel(auth.id);
        return;
      }
      attempt.current = auth.id;
      setConnecting(true);
      try {
        await open(auth.url);
        const next = await calendar.complete(auth.id);
        if (mounted.current && attempt.current === auth.id) {
          setSnapshot(next);
          setNeedsReconnect(false);
          attempt.current = null;
          onReset?.();
        }
      } catch (e) {
        await calendar.cancel(auth.id);
        throw e;
      }
    });
  }

  const sync = () => void run(async () => setSnapshot(await calendar.sync()));

  const disconnect = () =>
    void run(async () => {
      await calendar.disconnect();
      setSnapshot(emptyCalendar);
      setNeedsReconnect(false);
      onReset?.();
    });

  const cancel = () =>
    void calendar
      .cancel(attempt.current ?? undefined)
      .catch(() => setError(t('outlook.cancelError')));

  return {
    snapshot,
    error,
    setError,
    busy,
    connecting,
    needsReconnect,
    /** Connected and usable without a new authorization. */
    connected: Boolean(snapshot.account) && !needsReconnect,
    clientId,
    setClientId,
    tenant,
    setTenant,
    run,
    connect,
    sync,
    disconnect,
    cancel,
    retry: () => {
      setError('');
      setRetry((value) => value + 1);
    },
  };
}

export type OutlookConnection = ReturnType<typeof useOutlookConnection>;
