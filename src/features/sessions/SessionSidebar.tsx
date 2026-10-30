import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { sessions, useRefreshSessions, useSessions } from './sessions';
import { SessionGroups } from './SessionList';
import { SidebarPeriodFilter } from './SidebarPeriodFilter';
import './sidebar.css';
import { inPeriod, sessionDate } from './sessionDates';
import { useSessionNavigation } from './sessionNavigation';

export function SessionSidebar() {
  const { t } = useTranslation();
  if (!sessions.available())
    return (
      <section className="px-2 py-4 space-y-3">
        <button disabled className="text-sm">
          {t('session.new')}
        </button>
        <p role="status" className="text-xs">
          {t('library.desktopRequired')}
        </p>
      </section>
    );
  return <DesktopSessionSidebar />;
}
function DesktopSessionSidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const period = useSessionNavigation((s) => s.sidebarPeriod);
  const query = useSessions();
  const refresh = useRefreshSessions();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const visible = (query.data ?? []).filter((s) => !sessionDate(s) || inPeriod(s, period));
  return (
    <section className="space-y-2 mt-2" aria-label={t('session.sessions')}>
      <header className="flex items-center gap-1 pt-3">
        <h2 className="min-w-0 flex-1 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('session.sessions')}
        </h2>
        <SidebarPeriodFilter />
        <button
          type="button"
          className="session-header-icon"
          aria-label={t('session.new')}
          title={t('session.new')}
          disabled={!sessions.available()}
          onClick={() => {
            setCreating((value) => !value);
          }}
        >
          <Plus size={15} aria-hidden="true" />
        </button>
      </header>
      <div>
        {creating && (
          <form
            className="space-y-2 p-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy || !title.trim()) return;
              setBusy(true);
              setFailed(false);
              try {
                const session = await sessions.create({
                  title: title.trim(),
                  starts_at: null,
                  ends_at: null,
                  status: 'planned',
                });
                setCreating(false);
                setTitle('');
                await refresh();
                await navigate({ to: '/sessions/$sessionId', params: { sessionId: session.id } });
              } catch {
                setFailed(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="text-xs">
              {t('session.title')}
              <input
                autoFocus
                className="w-full mt-1 rounded border bg-background p-2"
                maxLength={500}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
              />
            </label>
            <button className="text-sm p-2 border rounded" disabled={busy || !title.trim()}>
              {t('session.create')}
            </button>
            {failed && (
              <p role="alert" className="text-xs">
                {t('session.createFailed')}
              </p>
            )}
          </form>
        )}
        {!sessions.available() ? (
          <p className="px-2 text-xs" role="status">
            {t('library.desktopRequired')}
          </p>
        ) : query.isPending ? (
          <p className="px-2 text-xs" role="status">
            {t('session.loading')}
          </p>
        ) : query.isError ? (
          <div role="alert" className="px-2 text-xs">
            <p>{t('session.loadFailed')}</p>
            <button onClick={() => void query.refetch()}>{t('session.retry')}</button>
          </div>
        ) : !query.data?.length ? (
          <p className="px-2 text-xs text-muted-foreground">{t('session.empty')}</p>
        ) : null}
        {!!query.data?.length && !visible.length && (
          <div className="px-2 text-xs space-y-2">
            <p>{t('sessionCalendar.empty')}</p>
            <button
              type="button"
              className="underline focus-visible:outline focus-visible:outline-ring"
              onClick={() => useSessionNavigation.setState({ sidebarPeriod: { kind: 'all' } })}
            >
              {t('sessionCalendar.reset')}
            </button>
          </div>
        )}
        <SessionGroups rows={visible} compact />
      </div>
    </section>
  );
}
