import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, FileText, Plus } from 'lucide-react';
import type { Note } from '../../lib/bindings';
import { useAppStore } from '../../lib/store';
import { Button, Input } from '../../components/ui';
import { NOTE_DRAG_TYPE } from '../board/BoardCanvas';
import { areaProgress } from '../board/hierarchy';
import type { BoardItem } from '../board/model';
import { sessionListCache } from '../sessions/sessions';
import { offBoardNotes, resolveNote } from './workspaceModel';
import type { Workspace } from './useWorkspace';

/** Full-text hits for the drawer search (debounced `search_notes`). */
function useSearch(query: string) {
  const searchNotes = useAppStore((s) => s.searchNotes);
  const [hits, setHits] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      searchNotes(query.trim())
        .then((found) => live && setHits(new Set(found.map((n) => n.id))))
        .catch(() => live && setHits(null));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, searchNotes]);
  return hits;
}

/**
 * Left drawer "Notas": search across every note, notes off the board (meeting,
 * shortcut and palette notes) with "Colocar no quadro", and the board outline.
 * Collapses to a vertical tab while the editor is open unless pinned open.
 */
export function NotesDrawer({ ws }: { ws: Workspace }) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const hits = useSearch(query);
  const sessions = sessionListCache((s) => s.data);
  const q = query.trim().toLocaleLowerCase();
  const matches = (title: string, note?: Note) =>
    !q || title.toLocaleLowerCase().includes(q) || (!!note && !!hits?.has(note.id));
  const allLoose = offBoardNotes(ws.notes, ws.board);
  const loose = allLoose.filter((n) => matches(n.title || t('workspace.untitled'), n));
  const placed = (ws.board?.items ?? []).filter((i) =>
    matches(ws.title(i), resolveNote(ws.notes, i))
  );
  const collapsed = ws.editorOpen && !ws.drawerOpen;
  const day = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' });
  const date = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' });
  const subtitle = (note: Note) => {
    const meeting = sessions?.find((s) => s.personal_note?.id === note.id);
    const when = new Date(meeting?.starts_at ?? note.updated_at);
    if (meeting) return t('workspace.drawer.meetingNote', { day: day.format(when) });
    return t('workspace.drawer.updated', { date: date.format(when) });
  };
  const kindOf = (item: BoardItem) =>
    item.kind === 'area'
      ? t('workspace.drawer.areaItem', { count: areaProgress(ws.board!, item.id).count })
      : item.kind === 'card'
        ? t('workspace.drawer.activityItem', { progress: item.progress ?? 0 })
        : t('workspace.drawer.noteItem');

  return (
    <aside
      className="ws-drawer"
      data-collapsed={collapsed || undefined}
      aria-label={t('workspace.drawer.label')}
    >
      {collapsed ? (
        <button
          type="button"
          className="ws-drawer-tab"
          aria-expanded={false}
          onClick={() => ws.setDrawerOpen(true)}
        >
          <FileText size={14} aria-hidden="true" />
          {t('workspace.drawer.tab', { count: allLoose.length })}
        </button>
      ) : (
        <>
          <div className="ws-drawer-head">
            <div className="flex items-center gap-1.5">
              <h2 className="ws-drawer-title">{t('workspace.drawer.title')}</h2>
              {ws.editorOpen && (
                <Button
                  iconOnly
                  variant="ghost"
                  size="xs"
                  aria-label={t('workspace.drawer.collapse')}
                  title={t('workspace.drawer.collapse')}
                  aria-expanded
                  icon={<ChevronLeft size={14} aria-hidden="true" />}
                  onClick={() => ws.setDrawerOpen(false)}
                />
              )}
            </div>
            <Input
              type="search"
              value={query}
              placeholder={t('workspace.drawer.search')}
              aria-label={t('workspace.drawer.search')}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="ws-drawer-scroll">
            <h3 className="ws-drawer-group">
              {t('workspace.drawer.offBoard', { count: loose.length })}
            </h3>
            {!loose.length && (
              <p className="ws-drawer-empty">
                {t(q ? 'workspace.drawer.noMatch' : 'workspace.drawer.allPlaced')}
              </p>
            )}
            <ul aria-label={t('workspace.drawer.offBoardList')}>
              {loose.map((n) => {
                const title = n.title || t('workspace.untitled');
                return (
                  <li
                    key={n.id}
                    className="ws-drawer-row"
                    draggable
                    title={t('workspace.drawer.dragHint')}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(NOTE_DRAG_TYPE, n.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                  >
                    <button
                      type="button"
                      className="ws-drawer-open"
                      aria-current={ws.sel.noteId === n.id || undefined}
                      onClick={() => ws.openNote(n.id)}
                    >
                      <b>{title}</b>
                      <span>{subtitle(n)}</span>
                    </button>
                    <Button
                      size="xs"
                      variant="ghost"
                      icon={<Plus size={12} aria-hidden="true" />}
                      aria-label={t('workspace.drawer.placeNote', { title })}
                      onClick={(e) => ws.place(n.id, e.currentTarget.closest('li'))}
                    >
                      {t('workspace.drawer.place')}
                    </Button>
                  </li>
                );
              })}
            </ul>
            <h3 className="ws-drawer-group">
              {t('workspace.drawer.onBoard', { count: placed.length })}
            </h3>
            <ul aria-label={t('workspace.drawer.onBoardList')}>
              {placed.map((i) => (
                <li key={i.id} className="ws-drawer-row">
                  <button
                    type="button"
                    className="ws-drawer-open"
                    aria-current={ws.item?.id === i.id || undefined}
                    onClick={() => ws.selectById(i.id, true)}
                  >
                    <b>{ws.title(i)}</b>
                    <span>{kindOf(i)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </aside>
  );
}
