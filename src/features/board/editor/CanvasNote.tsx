import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { JSONContent } from '@tiptap/core';
import { commands, type NoteContent } from '../../../lib/bindings';
import { noteSaveQueue, waitForNotePersistence } from '../../../lib/noteSessions';
import { isExitLocked, subscribeExitLock } from '../../../lib/lifecycle';
import { useNoteRecovery } from '../../notes/useNoteRecovery';
import { NoteRecovery } from '../../notes/NoteRecovery';
import type { EditorFocusRequest } from '../../notes/editorFocusRequest';
import { CanvasTextEditor } from './CanvasTextEditor';
import { CanvasTextView } from './CanvasTextView';
import { canvasMarkdown, parseCanvasMarkdown } from './markdown';
import '../locale';
import './canvasText.css';
export type CanvasNoteProps = {
  noteId: string;
  editing: boolean;
  edit: () => void;
  close: () => void;
  activity?: boolean;
  focusRequest?: EditorFocusRequest;
};
export function CanvasNote(props: CanvasNoteProps) {
  const { t } = useTranslation('board');
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['note', props.noteId],
    queryFn: async () => {
      await waitForNotePersistence(props.noteId).catch(() => {});
      const result = await commands.getNote(props.noteId);
      if (result.status === 'error') throw new Error(result.error);
      return result.data;
    },
    refetchOnWindowFocus: false,
    retry: false,
  });
  if (query.isError)
    return (
      <div role="alert">
        {t('noteLoadError')}
        <button onClick={() => void query.refetch()}>{t('retryLoad')}</button>
      </div>
    );
  if (!query.data) return <p role="status">{t('loading')}</p>;
  return <CanvasNoteContent {...props} content={query.data} client={client} />;
}
export function CanvasNoteContent({
  content,
  client,
  ...props
}: CanvasNoteProps & { content: NoteContent; client: ReturnType<typeof useQueryClient> }) {
  const { ready, recovery, retry, save } = useNoteRecovery(props.noteId, content, client);
  if (recovery)
    return <NoteRecovery snapshot={recovery.snapshot} error={recovery.error} retry={retry} />;
  if (!ready) return null;
  return (
    <CanvasNoteBody
      key={props.noteId}
      {...props}
      markdown={ready.markdown}
      save={save}
      externalMarkdown={content.markdown}
      latest={() => client.getQueryData<NoteContent>(['note', props.noteId])?.markdown}
    />
  );
}
function CanvasNoteBody({
  noteId,
  markdown,
  save,
  editing,
  edit,
  close,
  activity = true,
  focusRequest,
  externalMarkdown,
  latest,
}: CanvasNoteProps & {
  markdown: string;
  save: (markdown: string) => Promise<void>;
  externalMarkdown: string;
  latest: () => string | undefined;
}) {
  const { t } = useTranslation('board');
  const [doc, setDoc] = useState(() => parseCanvasMarkdown(markdown, activity));
  const [failed, setFailed] = useState(false);
  const locked = useSyncExternalStore(subscribeExitLock, isExitLocked, isExitLocked);
  const live = useRef(true),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;
  const queue = useMemo(() => noteSaveQueue(noteId, (text) => saveRef.current(text)), [noteId]);
  const flush = () =>
    queue
      .flush()
      .then(() => {
        if (live.current) setFailed(false);
      })
      .catch(() => {
        if (live.current) setFailed(true);
      });
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      clearTimeout(timer.current);
      void queue.flush().catch(() => {});
    };
  }, [queue]);
  const latestRef = useRef(latest);
  latestRef.current = latest;
  useEffect(() => {
    if (editing) return;
    let current = true;
    void waitForNotePersistence(noteId)
      .then(() => {
        const saved = latestRef.current();
        if (current && saved !== undefined) setDoc(parseCanvasMarkdown(saved, activity));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [externalMarkdown, editing, noteId, activity]);
  function change(next: JSONContent) {
    if (locked) return;
    const serialized = canvasMarkdown(next, activity);
    setDoc(next);
    queue.change(Promise.resolve(serialized));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 400);
  }
  return (
    <div
      className={`canvas-note ${activity ? 'canvas-activity' : 'canvas-free-text'} nodrag nopan nowheel`}
    >
      {editing ? (
        <CanvasTextEditor
          initial={doc}
          change={change}
          focusRequest={focusRequest}
          close={() => {
            void flush();
            close();
          }}
        />
      ) : (
        <div
          className="canvas-text canvas-read"
          role="group"
          tabIndex={0}
          aria-label={t(activity ? 'editActivity' : 'editText')}
          onDoubleClick={(e) => {
            e.stopPropagation();
            edit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.target === e.currentTarget) {
              e.preventDefault();
              edit();
            }
          }}
        >
          <CanvasTextView
            doc={doc}
            toggle={
              locked
                ? undefined
                : (path) => {
                    const next = structuredClone(doc);
                    let row = next;
                    for (const i of path) row = row.content![i];
                    row.attrs = { ...row.attrs, checked: !row.attrs?.checked };
                    change(next);
                  }
            }
          />
        </div>
      )}
      {failed && (
        <div className="canvas-save-error" role="alert">
          {t('noteSaveFailed')}{' '}
          <button type="button" onClick={() => void flush()}>
            {t('retry')}
          </button>
        </div>
      )}
    </div>
  );
}
