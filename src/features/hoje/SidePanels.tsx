import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Note } from '../../lib/bindings';
import { relativeDay } from './format';
import type { ReviewGroup } from './hojeData';
import { useGo, useOpenMeeting } from './hojeNavigation';
import { Panel, PanelEmpty, PanelError, PanelLoading } from './Panel';

type ReviewProps = {
  groups: ReviewGroup[];
  state: 'loading' | 'error' | 'ready';
  onRetry: () => void;
};

/** Counts that need a decision; each line opens its most recent meeting. */
export function ReviewPanel({ groups, state, onRetry }: ReviewProps) {
  const { t } = useTranslation();
  return (
    <Panel id="hoje-review" span={3} title={t('hoje.review.title')}>
      {state === 'error' ? (
        <PanelError message={t('hoje.review.loadError')} onRetry={onRetry} />
      ) : state === 'loading' ? (
        <PanelLoading />
      ) : groups.length ? (
        <ul className="cx-hoje-list">
          {groups.map((group) => (
            <ReviewItem key={group.kind} group={group} />
          ))}
        </ul>
      ) : (
        <PanelEmpty>{t('hoje.review.empty')}</PanelEmpty>
      )}
    </Panel>
  );
}

function ReviewItem({ group }: { group: ReviewGroup }) {
  const { t } = useTranslation();
  const open = useOpenMeeting();
  const title = useRef<HTMLElement>(null);
  const [first, ...rest] = group.sessions;
  const count = group.sessions.length;
  return (
    <li>
      <button
        type="button"
        className="cx-hoje-row cx-hoje-review-row"
        data-review={group.kind}
        onClick={() => open(first.id, title.current)}
      >
        <span className="cx-hoje-count" data-tone={group.kind === 'failed' ? 'warning' : undefined}>
          {count}
        </span>
        <span className="min-w-0">
          <span className="cx-hoje-row-label">{t(`hoje.review.${group.kind}`, { count })}</span>
          <span className="cx-hoje-meta">
            <span ref={title}>{first.title}</span>
            {rest.length > 0 && ` ${t('hoje.review.more', { count: rest.length })}`}
          </span>
        </span>
      </button>
    </li>
  );
}

type NotesProps = {
  notes: Note[];
  now: Date;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
};

export function NotesPanel({ notes, now, loading, failed, onRetry }: NotesProps) {
  const { t, i18n } = useTranslation();
  const go = useGo();
  const recent = [...notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 3);
  const when = (n: Note) => {
    const r = relativeDay(n.updated_at, now, i18n.resolvedLanguage);
    if (!r) return '';
    if (r.kind === 'today') return t('hoje.notes.today', { time: r.time });
    if (r.kind === 'yesterday') return t('hoje.notes.yesterday');
    return r.text;
  };
  return (
    <Panel
      id="hoje-notes"
      span={3}
      title={t('hoje.notes.title')}
      action={{ label: t('hoje.notes.open'), onClick: go.workspace }}
    >
      {failed && <PanelError message={t('hoje.notes.loadError')} onRetry={onRetry} />}
      {recent.length ? (
        <ul className="cx-hoje-list">
          {recent.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="cx-hoje-row cx-hoje-note-row"
                data-note={n.id}
                onClick={() => go.note(n.id)}
              >
                <span className="min-w-0">
                  <b className="cx-hoje-row-title">{n.title.trim() || t('hoje.notes.untitled')}</b>
                  <span className="cx-hoje-meta">
                    {[when(n), n.tags[0] ? `# ${n.tags[0]}` : ''].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : loading ? (
        <PanelLoading />
      ) : failed ? null : (
        <PanelEmpty>{t('hoje.notes.empty')}</PanelEmpty>
      )}
    </Panel>
  );
}
