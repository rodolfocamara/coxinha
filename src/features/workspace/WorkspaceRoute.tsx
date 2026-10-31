import { useTranslation } from 'react-i18next';
import { LayoutGrid, Plus } from 'lucide-react';
import { Alert, Button, EmptyState } from '../../components/ui';
import { BoardCanvas } from '../board/BoardCanvas';
import { NotesDrawer } from './NotesDrawer';
import { SideEditor } from './SideEditor';
import { WorkspaceToolbar } from './WorkspaceToolbar';
import { useWorkspace } from './useWorkspace';
import './workspace.css';

/**
 * Spec 0096 P5: `/workspace` and `/workspace/$noteId`. Notes drawer, canvas
 * (areas, activities, notes, dependencies) and the side editor, the only
 * place a note is edited. An activity is the same note as a `card` item.
 */
export function WorkspaceRoute() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  if (ws.session.loadError)
    return (
      <div className="p-8">
        <Alert
          tone="error"
          action={
            <Button size="xs" onClick={ws.session.load}>
              {t('workspace.retry')}
            </Button>
          }
        >
          {t('workspace.errors.load')}
        </Alert>
      </div>
    );
  const board = ws.board;
  return (
    <div className="ws-root" data-expanded={ws.expanded || undefined}>
      <NotesDrawer ws={ws} />
      <section className="ws-main" aria-label={t('workspace.canvas.label')}>
        <WorkspaceToolbar ws={ws} />
        {!board ? (
          <p role="status" className="p-6 text-muted-foreground">
            {t('workspace.loading')}
          </p>
        ) : (
          <BoardCanvas
            board={board}
            notes={ws.notes}
            selected={ws.item?.id ?? null}
            fx={ws.fx}
            viewport={ws.viewport}
            title={ws.title}
            onSelect={ws.select}
            onPromote={ws.promote}
            onCreateAt={(point) => ws.createNote(point)}
            onDropNote={(noteId, point) => ws.place(noteId, null, point)}
          >
            {board.items.length === 0 && (
              <div className="ws-empty">
                <EmptyState
                  icon={<LayoutGrid size={28} strokeWidth={1.4} aria-hidden="true" />}
                  title={t('workspace.empty.title')}
                  description={t('workspace.empty.body')}
                  action={
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Plus size={14} aria-hidden="true" />}
                      onClick={ws.createActivity}
                    >
                      {t('workspace.empty.action')}
                    </Button>
                  }
                />
              </div>
            )}
          </BoardCanvas>
        )}
      </section>
      {ws.editorOpen && <SideEditor ws={ws} />}
    </div>
  );
}
