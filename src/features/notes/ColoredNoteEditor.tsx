import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NoteContent } from '../../lib/bindings';
import type { EditorFocusRequest } from './editorFocusRequest';
import { CanvasNoteContent } from '../board/editor/CanvasNote';
/** Keep canvas color markup intact when the same note opens outside the board. */
export function ColoredNoteEditor({
  noteId,
  content,
  focusRequest,
}: {
  noteId: string;
  content: NoteContent;
  focusRequest?: EditorFocusRequest;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(true);
  return (
    <CanvasNoteContent
      noteId={noteId}
      content={content}
      client={client}
      editing={editing}
      edit={() => setEditing(true)}
      close={() => setEditing(false)}
      activity={/^\s*#/.test(content.markdown)}
      focusRequest={focusRequest}
    />
  );
}
