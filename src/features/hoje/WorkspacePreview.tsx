import type { CSSProperties } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import type { Board } from '../board/model';
import { formatWeekday } from './format';
import {
  cardProgress,
  formatDuration,
  mainAreaProgress,
  previewCards,
  type WeekStats,
} from './hojeData';
import { useGo, useZoomToWorkspace } from './hojeNavigation';
import type { Loadable } from './useHojeData';
import { Panel, PanelEmpty, PanelError, PanelLoading } from './Panel';

type PreviewProps = { state: Loadable<Board>; onRetry: () => void };

/**
 * A door into the Workspace. The preview and each card carry the same
 * view-transition names as the Workspace canvas and its cards (`ws-canvas`,
 * `card-<id>`), so opening it is a zoom where the cards fly to their places.
 */
export function WorkspacePreview({ state, onRetry }: PreviewProps) {
  const { t } = useTranslation();
  const go = useGo();
  const zoom = useZoomToWorkspace();
  const board = state.kind === 'ready' ? state.data : null;
  const cards = previewCards(board);
  const area = mainAreaProgress(board);
  return (
    <Panel
      id="hoje-workspace"
      span={8}
      title={t('hoje.workspace.title')}
      extra={
        area && (
          <span className="cx-hoje-pill">
            {t('hoje.workspace.progress', { label: area.label, pct: area.pct })}
          </span>
        )
      }
      action={{ label: t('hoje.workspace.open'), onClick: go.workspace }}
    >
      {state.kind === 'error' ? (
        <PanelError message={t('hoje.workspace.loadError')} onRetry={onRetry} />
      ) : state.kind === 'loading' ? (
        <PanelLoading />
      ) : cards.length === 0 ? (
        <PanelEmpty
          action={
            <Button size="sm" onClick={go.workspace}>
              {t('hoje.workspace.create')}
            </Button>
          }
        >
          {t('hoje.workspace.empty')}
        </PanelEmpty>
      ) : (
        // Mouse affordance only: the header "Abrir" button is the keyboard path.
        <div
          className="cx-hoje-mini"
          data-workspace-preview
          style={{ viewTransitionName: 'ws-canvas' } as CSSProperties}
          title={t('hoje.workspace.hint')}
          onClick={(e) => zoom(e.currentTarget)}
        >
          {cards.map(({ item, fx, fy }) => {
            const pct = cardProgress(item);
            return (
              <button
                key={item.id}
                type="button"
                className="cx-hoje-mini-card"
                data-card={item.id}
                aria-label={t('hoje.workspace.cardLabel', { title: item.label, pct })}
                style={
                  {
                    '--fx': fx,
                    '--fy': fy,
                    viewTransitionName: `card-${item.id}`,
                    viewTransitionClass: 'card',
                  } as CSSProperties
                }
                onClick={(e) => {
                  e.stopPropagation();
                  zoom(e.currentTarget, item.noteId);
                }}
              >
                <span className="cx-hoje-mini-title">{item.label}</span>
                <i className="cx-hoje-progress" aria-hidden="true">
                  <b data-done={pct >= 100 || undefined} style={{ width: `${pct}%` }} />
                </i>
              </button>
            );
          })}
          <span className="cx-hoje-mini-hint" aria-hidden="true">
            <ChevronRight size={12} />
            {t('hoje.workspace.hint')}
          </span>
        </div>
      )}
    </Panel>
  );
}

type WeekProps = { stats: WeekStats; state: 'loading' | 'error' | 'ready'; onRetry: () => void };

export function WeekPanel({ stats, state, onRetry }: WeekProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const max = Math.max(...stats.days.map((d) => d.ms), 1);
  return (
    <Panel
      id="hoje-week"
      span={4}
      title={t('hoje.week.title')}
      extra={
        state === 'ready' && (
          <span className="cx-hoje-week-total">
            {stats.totalMs
              ? t('hoje.week.recorded', { duration: formatDuration(stats.totalMs) })
              : t('hoje.week.nothing')}
          </span>
        )
      }
    >
      {state === 'error' ? (
        <PanelError message={t('hoje.week.loadError')} onRetry={onRetry} />
      ) : state === 'loading' ? (
        <PanelLoading />
      ) : (
        <>
          <ol className="cx-hoje-week">
            {stats.days.map((d) => {
              const day = formatWeekday(d.date, locale);
              return (
                <li
                  key={d.key}
                  data-today={d.isToday || undefined}
                  aria-label={t('hoje.week.dayLabel', { day, duration: formatDuration(d.ms) })}
                >
                  <i style={{ height: `${Math.max(3, Math.round((d.ms / max) * 46))}px` }} />
                  <span aria-hidden="true">{day}</span>
                </li>
              );
            })}
          </ol>
          <p className="cx-hoje-week-summary">
            {stats.meetings === 0
              ? t('hoje.week.none')
              : t('hoje.week.summary', {
                  meetings: t('hoje.week.meetings', { count: stats.meetings }),
                  transcribed: t('hoje.week.transcribed', { count: stats.transcribed }),
                  failed: t('hoje.week.failed', { count: stats.failed }),
                })}
          </p>
        </>
      )}
    </Panel>
  );
}
