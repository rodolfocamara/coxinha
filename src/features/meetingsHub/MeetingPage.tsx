import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, RotateCw } from 'lucide-react';
import { Alert, Button } from '../../components/ui';
import { refreshSessionList, sessions } from '../sessions/sessions';
import { MeetingDetail, type DetailProps } from './MeetingDetail';
import './calendarPeek.css';

/**
 * A meeting's full page (spec 0107): its tabs at full width, with the way
 * back to the calendar at the date and view it was opened from. Session
 * detail is loaded by ID so a session created a moment ago opens at once.
 */
export function MeetingPage({ onBack, ...props }: DetailProps & { onBack: () => void }) {
  const { t } = useTranslation();
  const { target } = props;
  const sessionId = target.kind === 'session' ? target.sessionId : null;
  const query = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessions.detail(sessionId!),
    enabled: !!sessionId && sessions.available(),
    retry: false,
    refetchInterval: 3000,
  });
  const session = target.kind === 'session' ? (query.data ?? target.row?.session ?? null) : null;
  return (
    <div className="ch-page">
      <nav className="ch-page-bar" aria-label={t('meetingsHub.home.pageNav')}>
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowLeft size={14} aria-hidden="true" />}
          onClick={onBack}
        >
          {t('meetingsHub.home.backToCalendar')}
        </Button>
      </nav>
      {target.kind === 'session' && !session ? (
        <div className="mh-detail p-6">
          {query.isError ? (
            <Alert
              tone="error"
              action={
                <Button
                  size="sm"
                  onClick={() => void query.refetch()}
                  icon={<RotateCw size={14} aria-hidden="true" />}
                >
                  {t('meetingsHub.retry')}
                </Button>
              }
            >
              {t('meetingsHub.detailFailed')}
            </Alert>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {t('meetingsHub.loading')}
            </p>
          )}
        </div>
      ) : (
        <MeetingDetail
          {...props}
          session={session}
          staleError={query.isError}
          refetch={async () => {
            if (sessionId) await query.refetch();
            await refreshSessionList();
          }}
        />
      )}
    </div>
  );
}
