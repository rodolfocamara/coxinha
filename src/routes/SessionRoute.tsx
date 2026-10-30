import { useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/AppShell';
import { Alert, Button, EmptyState } from '../components/ui';
import { SessionHeading } from '../features/sessions/SessionHeading';
import { SessionNotes } from '../features/sessions/SessionNotes';
import { SessionRecording } from '../features/sessions/SessionRecording';
import { useAcknowledgedSessionCapture } from '../features/sessions/sessionCapture';
import { sessions, useRefreshSessions } from '../features/sessions/sessions';

type Tab = 'notes' | 'transcript' | 'summary' | 'people';
const tabs: Tab[] = ['notes', 'transcript', 'summary', 'people'];
export function SessionRoute() {
  const { sessionId } = useParams({ from: '/sessions/$sessionId' });
  const { t } = useTranslation();
  return (
    <AppShell trail={[t('session.workspace')]}>
      <SessionWorkspace key={sessionId} sessionId={sessionId} />
    </AppShell>
  );
}
export function SessionWorkspace({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const refreshSessions = useRefreshSessions();
  const [tab, setTab] = useState<Tab>('notes');
  const acknowledgedMeeting = useAcknowledgedSessionCapture(sessionId);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const query = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessions.detail(sessionId),
    retry: false,
    enabled: sessions.available(),
    refetchInterval: 3000,
  });
  const session = query.data;
  // Route-independent acknowledgement survives stale null metadata and failed refetches.
  const meetingId = session?.meeting_id ?? acknowledgedMeeting;
  const refresh = async () => {
    await query.refetch();
    await refreshSessions();
  };
  const retryButton = (
    <Button size="sm" onClick={() => void query.refetch()}>
      {t('session.retry')}
    </Button>
  );
  return (
    <div className="h-full overflow-auto bg-card">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-5 space-y-3">
        {!sessions.available() ? (
          <Alert tone="info">{t('library.desktopRequired')}</Alert>
        ) : query.isError && !session ? (
          <Alert tone="error" action={retryButton}>
            {t('session.loadFailed')}
          </Alert>
        ) : !session ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('session.loading')}
          </p>
        ) : (
          <>
            {query.isError && (
              <Alert tone="error" action={retryButton}>
                {t('session.loadFailed')}
              </Alert>
            )}
            <SessionHeading session={session} refresh={refresh} />
            <div
              role="tablist"
              aria-label={t('session.workspace')}
              className="flex flex-wrap gap-x-6 border-b border-border"
            >
              {tabs.map((id, i) => (
                <button
                  key={id}
                  ref={(el) => {
                    buttons.current[i] = el;
                  }}
                  id={`session-tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  aria-controls={`session-panel-${id}`}
                  tabIndex={tab === id ? 0 : -1}
                  className="-mb-px border-b-2 border-transparent py-2.5 text-ui text-muted-foreground hover:text-foreground aria-selected:border-primary aria-selected:font-medium aria-selected:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  onClick={() => setTab(id)}
                  onKeyDown={(e) => {
                    const next =
                      e.key === 'Home'
                        ? 0
                        : e.key === 'End'
                          ? tabs.length - 1
                          : e.key === 'ArrowRight'
                            ? (i + 1) % tabs.length
                            : e.key === 'ArrowLeft'
                              ? (i + tabs.length - 1) % tabs.length
                              : null;
                    if (next !== null) {
                      e.preventDefault();
                      setTab(tabs[next]);
                      buttons.current[next]?.focus();
                    }
                  }}
                >
                  {t(`session.tabs.${id}`)}
                </button>
              ))}
            </div>
            <SessionRecording
              session={{ ...session, meeting_id: meetingId }}
              transcript={tab === 'transcript'}
              people={tab === 'people'}
              playbackScope={tab}
              onTranscript={() => {
                setTab('transcript');
                buttons.current[tabs.indexOf('transcript')]?.focus();
              }}
              refresh={refresh}
            />
            {tabs
              .filter((id) => !['transcript', 'people'].includes(id) || !meetingId)
              .map((id) => (
                <section
                  key={id}
                  id={`session-panel-${id}`}
                  role="tabpanel"
                  aria-labelledby={`session-tab-${id}`}
                  tabIndex={0}
                  hidden={tab !== id}
                >
                  {tab === id &&
                    (id === 'notes' ? (
                      <SessionNotes sessionId={session.id} />
                    ) : id === 'summary' ? (
                      <EmptyState title={t('session.summaryEmpty')} />
                    ) : !meetingId ? (
                      <EmptyState
                        title={t(
                          id === 'people' ? 'speakers.noRecording' : 'session.transcriptEmpty'
                        )}
                      />
                    ) : null)}
                </section>
              ))}
          </>
        )}
      </div>
    </div>
  );
}
