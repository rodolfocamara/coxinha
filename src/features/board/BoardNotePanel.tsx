import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { commands } from '../../lib/bindings';
import { waitForNotePersistence } from '../../lib/noteSessions';
import { NoteEditor, NoteLoadingSkeleton } from '../notes/NoteEditor';
import { NoteFileDiagnosticDetail } from '../notes/NoteFileDiagnosticDetail';
import type { EditorFocusRequest } from '../notes/editorFocusRequest';

export function BoardNotePanel({
  noteId,
  focusRequest,
  close,
}: {
  noteId: string;
  focusRequest: EditorFocusRequest;
  close: () => void;
}) {
  const { t } = useTranslation('board');
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['board-note', noteId],
    queryFn: async () => {
      // Failed retained writes are handled by NoteEditor's recovery surface.
      await waitForNotePersistence(noteId).catch(() => {});
      const result = await commands.getNote(noteId);
      if (result.status === 'error') throw new Error(result.error);
      client.setQueryData(['note', noteId], result.data);
      return result.data;
    },
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
  return (
    <aside
      className="board-note-panel"
      aria-label={t('editActivity')}
      onKeyDown={(event) => {
        const nestedPopup =
          event.target instanceof Element &&
          event.target.closest('[role="menu"], [role="listbox"], [role="dialog"]');
        if (event.key === 'Escape' && !event.defaultPrevented && !nestedPopup) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <header className="board-note-heading">
        <h2>{t('editActivity')}</h2>
        <button type="button" aria-label={t('closeEditor')} onClick={close}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div className="board-note-content">
        {query.isError ? (
          <div role="alert">
            <p>{t('noteLoadError')}</p>
            <NoteFileDiagnosticDetail error={query.error} />
            <button type="button" onClick={() => void query.refetch()}>
              {t('retryLoad')}
            </button>
          </div>
        ) : query.data ? (
          <NoteEditor
            key={noteId}
            noteId={noteId}
            content={query.data}
            variant="embedded"
            focusRequest={focusRequest}
          />
        ) : (
          <NoteLoadingSkeleton />
        )}
      </div>
    </aside>
  );
}
