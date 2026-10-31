import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CalendarDays, Maximize2, Minimize2, X } from 'lucide-react';
import { Alert, Button } from '../../components/ui';
import { prepareRouteTransition } from '../../lib/motion';
import { sessionListCache } from '../sessions/sessions';
import { AreaFields, LayoutFields } from '../board/BoardFields';
import { NoteEditor, NoteLoadingSkeleton } from '../notes/NoteEditor';
import { noteContentQueryOptions } from '../notes/noteQuery';
import { ChecklistActions } from './ChecklistActions';
import { ActivityProps, NoteProps, OffBoardProps } from './ItemProps';
import { KindSwitch } from './KindSwitch';
import type { Workspace } from './useWorkspace';

/** The Workspace's only editor: the note's Markdown plus its board properties. */
export function SideEditor({ ws }: { ws: Workspace }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { item, note } = ws;
  const noteId = ws.sel.noteId ?? note?.id ?? null;
  const sessions = sessionListCache((s) => s.data);
  const meeting = noteId ? sessions?.find((s) => s.personal_note?.id === noteId) : undefined;
  const edited = note?.updated_at
    ? new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }).format(
        new Date(note.updated_at)
      )
    : null;
  return (
    <aside
      className="ws-editor"
      data-expanded={ws.expanded || undefined}
      aria-label={t('workspace.editor.label')}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        // A nested menu (note actions, selects) closes first.
        if (document.querySelector('[role="menu"], [data-select-popup]')) return;
        event.preventDefault();
        ws.close();
      }}
    >
      <header className="ws-editor-head">
        {item && item.kind !== 'area' ? (
          <KindSwitch
            value={item.kind}
            onChange={(kind) => (kind === 'card' ? ws.promote(item.id) : ws.demote(item.id))}
          />
        ) : (
          <span className="ws-editor-kind">
            {t(item?.kind === 'area' ? 'workspace.kind.area' : 'workspace.kind.note')}
          </span>
        )}
        <span className="flex-1" />
        {noteId && (
          <Button
            iconOnly
            variant="ghost"
            size="sm"
            aria-label={t(ws.expanded ? 'workspace.editor.collapse' : 'workspace.editor.expand')}
            title={t(ws.expanded ? 'workspace.editor.collapse' : 'workspace.editor.expand')}
            aria-pressed={ws.expanded}
            icon={
              ws.expanded ? (
                <Minimize2 size={15} aria-hidden="true" />
              ) : (
                <Maximize2 size={15} aria-hidden="true" />
              )
            }
            onClick={() => ws.setExpanded(!ws.expanded)}
          />
        )}
        <Button
          iconOnly
          variant="ghost"
          size="sm"
          aria-label={t('workspace.editor.close')}
          title={t('workspace.editor.close')}
          icon={<X size={15} aria-hidden="true" />}
          onClick={ws.close}
        />
      </header>
      <div className="ws-editor-body">
        <div className="ws-editor-inner">
          {item?.kind === 'area' ? (
            <>
              <h2 className="ws-editor-title">{ws.title(item)}</h2>
              <AreaFields item={item} patch={(values) => ws.patch(item.id, values)} />
              <LayoutFields
                item={item}
                patch={(values) => ws.patch(item.id, values)}
                layer={(direction) => ws.layer(item.id, direction)}
                remove={() => {
                  ws.removeFromBoard(item.id);
                  ws.close();
                }}
              />
            </>
          ) : (
            <>
              <p className="ws-editor-meta">
                {meeting && (
                  <>
                    {t('workspace.editor.fromMeeting')}
                    <button
                      type="button"
                      className="ws-chip"
                      onClick={() =>
                        void navigate({
                          to: '/meetings/$sessionId',
                          params: { sessionId: meeting.id },
                          viewTransition: prepareRouteTransition('nav'),
                        })
                      }
                    >
                      <CalendarDays size={12} aria-hidden="true" />
                      {meeting.title || t('workspace.untitled')}
                    </button>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                {edited && (
                  <>
                    {t('workspace.editor.edited', { date: edited })}
                    <span aria-hidden="true">·</span>
                  </>
                )}
                {t('workspace.editor.file')}
              </p>
              {item?.kind === 'card' ? (
                <ActivityProps ws={ws} item={item} />
              ) : item ? (
                <NoteProps ws={ws} item={item} />
              ) : noteId ? (
                <OffBoardProps ws={ws} noteId={noteId} />
              ) : null}
              {item && !note && <Alert tone="warning">{t('workspace.editor.missing')}</Alert>}
              {noteId && <NoteBody ws={ws} noteId={noteId} />}
              {item && (
                <LayoutFields
                  item={item}
                  patch={(values) => ws.patch(item.id, values)}
                  layer={(direction) => ws.layer(item.id, direction)}
                  remove={() => ws.removeFromBoard(item.id)}
                />
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function NoteBody({ ws, noteId }: { ws: Workspace; noteId: string }) {
  const { t } = useTranslation();
  const query = useQuery({
    ...noteContentQueryOptions(noteId),
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (query.isError)
    return (
      <Alert
        tone="error"
        action={
          <Button size="xs" onClick={() => void query.refetch()}>
            {t('workspace.retry')}
          </Button>
        }
      >
        {t('workspace.editor.loadError')}
      </Alert>
    );
  if (!query.data) return <NoteLoadingSkeleton />;
  const onBoard = ws.item && ws.item.kind !== 'area' ? ws.item : undefined;
  return (
    <NoteEditor
      key={noteId}
      variant="workspace"
      noteId={noteId}
      content={query.data}
      focusRequest={ws.focusRequest}
      overlay={
        onBoard
          ? (editor) => (
              <ChecklistActions
                editor={editor}
                linked={ws.linkedTask}
                onCreate={ws.taskToActivity}
                onOpen={(id) => ws.selectById(id, true)}
              />
            )
          : undefined
      }
      onDeleted={() => ws.forgetNote(noteId)}
      onDuplicated={(copy) => ws.openNote(copy)}
    />
  );
}
