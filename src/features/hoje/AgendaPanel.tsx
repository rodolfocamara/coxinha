import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '../../components/ui';
import { LiveBadge } from '../capture/LiveBadge';
import { useIsLive } from '../capture/captureStore';
import { transcriptStatus } from '../sessions/transcriptStatus';
import { formatTime } from './format';
import { hasEnded, rowAction, type AgendaRow } from './hojeData';
import { useGo, useOpenMeeting } from './hojeNavigation';
import { Panel, PanelEmpty, PanelError, PanelLoading } from './Panel';

type Props = {
  rows: AgendaRow[];
  now: Date;
  sessionsState: 'loading' | 'error' | 'ready';
  onRetrySessions: () => void;
  calendarState: 'loading' | 'error' | 'ready';
  outlookConnected: boolean;
  onRetryCalendar: () => void;
};

export function AgendaPanel(props: Props) {
  const { t } = useTranslation();
  const go = useGo();
  const { rows, sessionsState, calendarState } = props;
  const loading = sessionsState === 'loading' && calendarState === 'loading';
  return (
    <Panel
      id="hoje-agenda"
      span={6}
      title={t('hoje.agenda.title')}
      action={{ label: t('hoje.agenda.all'), onClick: go.meetings }}
    >
      {sessionsState === 'error' && (
        <PanelError message={t('hoje.agenda.loadError')} onRetry={props.onRetrySessions} />
      )}
      {calendarState === 'error' && (
        <PanelError message={t('hoje.agenda.calendarError')} onRetry={props.onRetryCalendar} />
      )}
      {loading ? (
        <PanelLoading />
      ) : rows.length ? (
        <ul className="cx-hoje-list">
          {rows.map((row) => (
            <AgendaItem key={row.key} row={row} now={props.now} />
          ))}
        </ul>
      ) : sessionsState === 'ready' && calendarState !== 'loading' ? (
        props.outlookConnected || calendarState === 'error' ? (
          <PanelEmpty>{t('hoje.agenda.empty')}</PanelEmpty>
        ) : (
          <PanelEmpty
            action={
              <Button size="sm" onClick={go.integrations}>
                {t('hoje.agenda.connect')}
              </Button>
            }
          >
            {t('hoje.agenda.emptyNoOutlook')}
          </PanelEmpty>
        )
      ) : null}
    </Panel>
  );
}

function AgendaItem({ row, now }: { row: AgendaRow; now: Date }) {
  const { t, i18n } = useTranslation();
  const open = useOpenMeeting();
  const title = useRef<HTMLElement>(null);
  const live = useIsLive(row.session);
  const locale = i18n.resolvedLanguage;
  const action = rowAction(row, now);
  // The LiveBadge already says recording or paused; the meta keeps the event facts.
  const meta = metaParts(row, now, t, live);
  return (
    <li>
      <button
        type="button"
        className="cx-hoje-row cx-hoje-agenda-row"
        data-live={live || undefined}
        data-row={row.key}
        onClick={() => open(row.session?.id ?? null, title.current)}
      >
        <span className="cx-hoje-time">
          {row.allDay || !row.start ? t('hoje.agenda.allDay') : formatTime(row.start, locale)}
        </span>
        <span className="min-w-0">
          <b ref={title} className="cx-hoje-row-title">
            {row.title}
          </b>
          {meta.length > 0 && <span className="cx-hoje-meta">{meta.join(' · ')}</span>}
        </span>
        <span className="cx-hoje-row-end">
          {live ? (
            <LiveBadge session={row.session} />
          ) : action === 'none' ? null : (
            <span className="cx-hoje-chip">
              {t(action === 'prepare' ? 'hoje.agenda.prepare' : 'hoje.agenda.open')}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function metaParts(row: AgendaRow, now: Date, t: TFunction, live: boolean) {
  const parts: string[] = [];
  if (row.event) parts.push(t('hoje.agenda.outlook'));
  if (row.people > 0) parts.push(t('hoje.agenda.people', { count: row.people }));
  else if (row.event) parts.push(t('hoje.agenda.onlyYou'));
  if (live) return parts;
  if (row.session?.recording)
    parts.push(
      t(
        transcriptStatus(row.session) === 'available'
          ? 'hoje.agenda.transcribed'
          : 'hoje.agenda.recorded'
      )
    );
  else if (row.session && hasEnded(row, now)) parts.push(t('hoje.agenda.noRecording'));
  return parts;
}
